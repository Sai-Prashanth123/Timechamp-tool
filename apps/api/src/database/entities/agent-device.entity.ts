import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Organization } from './organization.entity';

@Entity('agent_devices')
export class AgentDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'device_token', unique: true })
  deviceToken: string;

  @Column({ nullable: true })
  hostname: string | null;

  @Column({ nullable: true })
  platform: string | null;

  @Column({ name: 'agent_version', nullable: true })
  agentVersion: string | null;

  @Column({ name: 'last_seen_at', nullable: true, type: 'timestamptz' })
  lastSeenAt: Date | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;
}
