import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

export type StreamMode = 'idle' | 'grid' | 'full';

@Entity('stream_sessions')
@Index(['userId', 'startedAt'])
@Index(['organizationId', 'isActive'])
export class StreamSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ nullable: true })
  socketId: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ nullable: true, type: 'timestamp' })
  endedAt: Date;

  @Column({ type: 'bigint', default: 0 })
  bytesRx: string;

  @Column({ type: 'bigint', default: 0 })
  bytesTx: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'enum', enum: ['idle', 'grid', 'full'], default: 'idle' })
  mode: StreamMode;

  @Column({ nullable: true, type: 'text' })
  disconnectReason: string;
}
