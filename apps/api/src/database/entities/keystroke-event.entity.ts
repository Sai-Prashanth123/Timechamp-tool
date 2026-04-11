import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('keystroke_events')
@Index(['organizationId', 'recordedAt'])
@Index(['userId', 'recordedAt'])
export class KeystrokeEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'keys_per_min', default: 0 })
  keysPerMin: number;

  @Column({ name: 'mouse_per_min', default: 0 })
  mousePerMin: number;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
