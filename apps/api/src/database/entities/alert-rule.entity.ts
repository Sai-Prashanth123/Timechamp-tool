import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum AlertType {
  IDLE_TOO_LONG = 'idle_too_long',
  OVERTIME = 'overtime',
  LATE_CLOCK_IN = 'late_clock_in',
  PRODUCTIVITY_BELOW = 'productivity_below',
}

@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column() name: string;
  @Column() type: string;
  @Column({ default: 30 }) threshold: number;
  @Column({ default: true }) enabled: boolean;
  @Column({ name: 'notify_email', default: true }) notifyEmail: boolean;
  @Column({ name: 'notify_in_app', default: true }) notifyInApp: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
