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

  @Column({ type: 'varchar', nullable: true })
  hostname: string | null;

  // Human-chosen label shown on the admin dashboard. The agent setup UI
  // asks for this at registration and stores it here; older agents that
  // don't send the field leave it null and we fall back to `hostname`.
  @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', nullable: true })
  platform: string | null;

  @Column({ name: 'agent_version', type: 'varchar', nullable: true })
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
