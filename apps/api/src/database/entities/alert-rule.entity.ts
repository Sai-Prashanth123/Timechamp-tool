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

  /** Legacy free-text field — kept for backward compatibility. */
  @Column({ type: 'varchar', length: 100, nullable: true }) metric: string | null;

  @Column({
    type: 'enum',
    enum: AlertType,
    default: AlertType.IDLE_TOO_LONG,
  })
  type: AlertType;

  /**
   * Threshold in minutes (idle/overtime/late clock-in)
   * or as an integer percentage 0-100 (productivity_below).
   */
  @Column({ default: 30 }) threshold: number;
  @Column({ default: true }) enabled: boolean;
  @Column({ name: 'notify_email', default: true }) notifyEmail: boolean;
  @Column({ name: 'notify_in_app', default: true }) notifyInApp: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
