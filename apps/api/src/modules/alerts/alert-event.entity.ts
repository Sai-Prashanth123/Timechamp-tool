import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('alert_events')
export class AlertEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'rule_id', nullable: true })
  ruleId: string | null;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ length: 100 })
  metric: string;

  @Column({ name: 'value_minutes' })
  valueMinutes: number;

  @Column({ name: 'threshold_minutes' })
  thresholdMinutes: number;

  @Column({ name: 'triggered_at', type: 'timestamptz', default: () => 'NOW()' })
  triggeredAt: Date;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'acknowledged_by', nullable: true })
  acknowledgedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
