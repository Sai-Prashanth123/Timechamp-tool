import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../database/entities/organization.entity';
import {
  Subscription,
  SubscriptionStatus,
} from '../../database/entities/subscription.entity';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @InjectRepository(Organization)
    private orgsRepo: Repository<Organization>,
    @InjectRepository(Subscription)
    private subsRepo: Repository<Subscription>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    // Public routes handled by JwtAuthGuard — skip if no user
    if (!user?.organizationId) return true;

    const org = await this.orgsRepo.findOne({
      where: { id: user.organizationId as string, isActive: true },
    });
    if (!org) throw new ForbiddenException('Organization not found or inactive');

    const sub = await this.subsRepo.findOne({
      where: { organizationId: user.organizationId as string },
    });
    if (sub && sub.status === SubscriptionStatus.CANCELED) {
      throw new ForbiddenException(
        'Subscription canceled. Please reactivate to continue.',
      );
    }

    return true;
  }
}
