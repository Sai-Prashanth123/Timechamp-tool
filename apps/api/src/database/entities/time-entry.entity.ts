import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum TimeEntrySource {
  AUTOMATIC = 'automatic',
  MANUAL = 'manual',
  EDITED = 'edited',
}

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'attendance_id', type: 'varchar', nullable: true })
  attendanceId: string | null;

  @Column({ name: 'project_id', type: 'varchar', nullable: true })
  projectId: string | null;

  @Column({ name: 'task_id', type: 'varchar', nullable: true })
  taskId: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({
    type: 'enum',
    enum: TimeEntrySource,
    default: TimeEntrySource.AUTOMATIC,
  })
  source: TimeEntrySource;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
