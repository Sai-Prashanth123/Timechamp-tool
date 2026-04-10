import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AlertRule, AlertType } from './alert-rule.entity';
import { User } from './user.entity';

@Entity('alert_events')
export class AlertEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'rule_id', type: 'varchar', nullable: true }) ruleId: string | null;

  @Column({
    type: 'enum',
    enum: AlertType,
    nullable: true,
  })
  type: AlertType | null;

  @Column('text', { nullable: true }) message: string | null;
  @Column({ name: 'seen_at', type: 'timestamptz', nullable: true }) seenAt: Date | null;

  @Column({
    name: 'triggered_at',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  triggeredAt: Date;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;

  @ManyToOne(() => AlertRule, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rule_id' })
  rule: AlertRule | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
