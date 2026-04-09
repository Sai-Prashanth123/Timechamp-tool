import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('agent_metrics')
@Index(['orgId', 'recordedAt'])
export class AgentMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  orgId: string;

  @Column('float', { default: 0 })
  cpuPercent: number;

  @Column('bigint', { default: 0 })
  memUsedMb: number;

  @Column('bigint', { default: 0 })
  memTotalMb: number;

  @Column('float', { default: 0 })
  agentCpuPercent: number;

  @Column('bigint', { default: 0 })
  agentMemMb: number;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
