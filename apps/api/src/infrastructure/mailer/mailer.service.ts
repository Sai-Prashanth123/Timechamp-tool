import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST', 'localhost'),
      port: this.config.get<number>('SMTP_PORT', 1025),
      secure: this.config.get<boolean>('SMTP_SECURE', false),
      auth:
        this.config.get('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
    });
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM', 'noreply@timechamp.io'),
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const url = `${this.config.get('APP_URL')}/verify-email?token=${token}`;
    await this.send(
      to,
      'Please verify your email — TimeChamp',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">Verify your email address</h2>
        <p style="color:#475569">Click the button below to verify your email. This link expires in 24 hours.</p>
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Verify email
        </a>
        <p style="color:#94a3b8;font-size:12px">Or paste this link: ${url}</p>
      </div>`,
    );
  }

  async sendInviteEmail(
    to: string,
    inviterName: string,
    orgName: string,
    token: string,
  ): Promise<void> {
    const url = `${this.config.get('APP_URL')}/accept-invite?token=${token}`;
    await this.send(
      to,
      `${inviterName} invited you to ${orgName} on TimeChamp`,
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">You've been invited!</h2>
        <p style="color:#475569"><strong>${inviterName}</strong> invited you to join <strong>${orgName}</strong> on TimeChamp.</p>
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Accept invite
        </a>
        <p style="color:#94a3b8;font-size:12px">This link expires in 72 hours. Or paste: ${url}</p>
      </div>`,
    );
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const url = `${this.config.get('APP_URL')}/reset-password?token=${token}`;
    await this.send(
      to,
      'Reset your TimeChamp password',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">Reset your password</h2>
        <p style="color:#475569">Click below to reset your password. This link expires in 1 hour.</p>
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Reset password
        </a>
        <p style="color:#94a3b8;font-size:12px">If you didn't request this, ignore this email. Or paste: ${url}</p>
      </div>`,
    );
  }
}
