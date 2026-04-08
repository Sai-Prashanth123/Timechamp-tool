import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('alert_events')
export class AlertEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id' }) organizationId: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'rule_id', nullable: true }) ruleId: string | null;
  @Column() type: string;
  @Column('text') message: string;
  @Column({ name: 'seen_at', nullable: true }) seenAt: Date | null;
  @CreateDateColumn() createdAt: Date;
  @ManyToOne(() => User) @JoinColumn({ name: 'user_id' }) user: User;
}
