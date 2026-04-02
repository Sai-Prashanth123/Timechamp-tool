import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('activity_events')
export class ActivityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'app_name', length: 255 })
  appName: string;

  @Column({ name: 'window_title', length: 500, nullable: true })
  windowTitle: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'duration_sec', default: 0 })
  durationSec: number;

  @Column({ name: 'keystroke_count', default: 0 })
  keystrokeCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
