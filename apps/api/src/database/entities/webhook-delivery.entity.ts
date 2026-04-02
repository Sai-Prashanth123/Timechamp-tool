import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WebhookEndpoint } from './webhook-endpoint.entity';

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'endpoint_id', nullable: true })
  endpointId: string | null;

  @ManyToOne(() => WebhookEndpoint, (e) => e.deliveries, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'endpoint_id' })
  endpoint: WebhookEndpoint | null;

  @Column({ name: 'event_type', length: 100 })
  eventType: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ name: 'status_code', nullable: true })
  statusCode: number | null;

  @Column({ name: 'attempt_count', default: 1 })
  attemptCount: number;

  @Column({ default: false })
  succeeded: boolean;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
