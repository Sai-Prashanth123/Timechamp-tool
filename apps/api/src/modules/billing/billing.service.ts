import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  Subscription,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AuditLogService } from '../admin/audit-log.service';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);
  private priceMap: Record<string, string> = {};

  constructor(
    @InjectRepository(Subscription)
    private subsRepo: Repository<Subscription>,
    @InjectRepository(Organization)
    private orgsRepo: Repository<Organization>,
    private config: ConfigService,
    private auditLogService: AuditLogService,
  ) {
    this.stripe = new Stripe(
      this.config.get<string>('STRIPE_SECRET_KEY')!,
      { apiVersion: '2023-10-16' },
    );
    this.priceMap = {
      [this.config.get<string>('STRIPE_PRICE_STARTER') ?? '']: 'starter',
      [this.config.get<string>('STRIPE_PRICE_PRO') ?? '']: 'pro',
      [this.config.get<string>('STRIPE_PRICE_ENTERPRISE') ?? '']: 'enterprise',
    };
  }

  getPlanName(priceId: string): string | null {
    return this.priceMap[priceId] ?? null;
  }

  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return this.subsRepo.findOne({ where: { organizationId } });
  }

  async createCheckoutSession(
    organizationId: string,
    priceId: string,
    seats: number,
  ): Promise<{ url: string }> {
    const sub = await this.subsRepo.findOne({ where: { organizationId } });
    const org = await this.orgsRepo.findOne({ where: { id: organizationId } });

    let customerId = sub?.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: org!.name,
        metadata: { organizationId },
      });
      customerId = customer.id;

      if (sub) {
        await this.subsRepo.update(sub.id, {
          stripeCustomerId: customerId,
        });
      }
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: seats }],
      success_url: `${this.config.get('APP_URL')}/settings/billing?success=true`,
      cancel_url: `${this.config.get('APP_URL')}/settings/billing?canceled=true`,
      metadata: { organizationId, seats: String(seats), priceId },
    });

    return { url: session.url! };
  }

  async createPortalSession(
    organizationId: string,
  ): Promise<{ url: string }> {
    const sub = await this.subsRepo.findOne({ where: { organizationId } });
    if (!sub?.stripeCustomerId) {
      throw new Error('No Stripe customer found for this organization');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.config.get('APP_URL')}/settings/billing`,
    });

    return { url: session.url };
  }

  async getInvoices(organizationId: string): Promise<Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    status: string | null;
    created: number;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>> {
    const sub = await this.subsRepo.findOne({ where: { organizationId } });
    if (!sub?.stripeCustomerId) return [];

    const invoices = await this.stripe.invoices.list({
      customer: sub.stripeCustomerId,
      limit: 24,
    });

    return invoices.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? null,
      created: inv.created,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.get<string>('STRIPE_WEBHOOK_SECRET')!,
      );
    } catch (err) {
      this.logger.error('Webhook signature verification failed', err);
      throw new Error('Invalid webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const { organizationId, seats, priceId } = session.metadata!;
        const plan = this.getPlanName(priceId ?? '') ?? 'starter';
        await this.subsRepo.update(
          { organizationId },
          {
            stripeSubscriptionId: session.subscription as string,
            stripeCustomerId: session.customer as string,
            status: SubscriptionStatus.ACTIVE,
            seats: parseInt(seats, 10),
            plan,
          },
        );
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const sub = await this.subsRepo.findOne({
          where: { stripeSubscriptionId: stripeSub.id },
        });
        if (sub) {
          const oldStatus = sub.status;
          const status =
            stripeSub.status === 'active'
              ? SubscriptionStatus.ACTIVE
              : stripeSub.status === 'past_due'
              ? SubscriptionStatus.PAST_DUE
              : sub.status;
          await this.subsRepo.update(sub.id, {
            status,
            currentPeriodStart: new Date(
              stripeSub.current_period_start * 1000,
            ),
            currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
          });
          void this.auditLogService.log(
            sub.organizationId,
            { id: null, email: 'stripe-webhook' },
            'subscription.changed',
            'subscription',
            sub.id,
            { oldStatus, newStatus: status, plan: sub.plan },
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = await this.subsRepo.findOne({
          where: { stripeCustomerId: invoice.customer as string },
        });
        if (sub) {
          await this.subsRepo.update(sub.id, {
            status: SubscriptionStatus.PAST_DUE,
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = await this.subsRepo.findOne({
          where: { stripeCustomerId: invoice.customer as string },
        });
        if (sub && invoice.lines?.data[0]?.period?.end) {
          await this.subsRepo.update(sub.id, {
            currentPeriodEnd: new Date(invoice.lines.data[0].period.end * 1000),
          });
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        this.logger.log(`Trial ending soon for subscription`);
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const sub = await this.subsRepo.findOne({
          where: { stripeSubscriptionId: stripeSub.id },
        });
        if (sub) {
          await this.subsRepo.update(sub.id, {
            status: SubscriptionStatus.CANCELED,
            canceledAt: new Date(),
          });
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }
}
