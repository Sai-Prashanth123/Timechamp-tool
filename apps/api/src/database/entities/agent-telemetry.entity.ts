import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('agent_telemetry')
@Index(['organizationId', 'recordedAt'])
@Index(['userId', 'recordedAt'])
export class AgentTelemetry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'agent_version', length: 32 })
  agentVersion: string;

  @Column({ length: 32 })
  os: string;

  @Column({ name: 'uptime_sec', type: 'bigint', default: 0 })
  uptimeSec: number;

  @Column({ name: 'mem_used_mb', type: 'float', default: 0 })
  memUsedMb: number;

  @Column({ name: 'cpu_percent', type: 'float', default: 0 })
  cpuPercent: number;

  @Column({ name: 'last_sync_success', default: false })
  lastSyncSuccess: boolean;

  @Column({ name: 'last_sync_latency_ms', default: 0 })
  lastSyncLatencyMs: number;

  @Column({ name: 'buffered_events', default: 0 })
  bufferedEvents: number;

  @Column({ name: 'sync_error_count', default: 0 })
  syncErrorCount: number;

  @Column({ name: 'has_screen_recording', default: false })
  hasScreenRecording: boolean;

  @Column({ name: 'has_accessibility', default: false })
  hasAccessibility: boolean;

  @Column({ name: 'url_detection_layer', default: 0 })
  urlDetectionLayer: number;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
