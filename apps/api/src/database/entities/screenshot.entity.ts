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

  @Column({ name: 's3_key', length: 500 })
  s3Key: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ name: 'file_size_bytes', default: 0 })
  fileSizeBytes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
