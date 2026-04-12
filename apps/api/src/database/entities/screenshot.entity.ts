import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('screenshots')
export class Screenshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  // Populated at ingest time from AgentAuthGuard's request.device.
  // Nullable because legacy rows (written before migration 019) have
  // no device context. LiveScreenshotView filters by this so "Watch
  // Live" on a specific agent card only streams that device's shots.
  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 's3_key', length: 500 })
  s3Key: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ name: 'file_size_bytes', default: 0 })
  fileSizeBytes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
