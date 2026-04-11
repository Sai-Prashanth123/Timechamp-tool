import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Matches the Go agent's `telemetry.AgentTelemetry` wire format
 * at apps/agent/internal/telemetry/agent_metrics.go (snake_case).
 * Identity fields (org_id, employee_id) are ignored server-side;
 * they come from the AgentAuthGuard.
 */
export class SyncTelemetryDto {
  @ApiProperty({ example: '1.2.3' })
  @IsString()
  agent_version: string;

  @ApiProperty({ example: 'windows' })
  @IsString()
  os: string;

  @ApiPropertyOptional({ example: 'org-uuid' })
  @IsOptional()
  @IsString()
  org_id?: string;

  @ApiPropertyOptional({ example: 'user-uuid' })
  @IsOptional()
  @IsString()
  employee_id?: string;

  @ApiProperty({ example: 3600 })
  @IsInt()
  @Min(0)
  uptime_sec: number;

  @ApiProperty({ example: 32.5 })
  @IsNumber()
  @Min(0)
  mem_used_mb: number;

  @ApiProperty({ example: 1.2 })
  @IsNumber()
  @Min(0)
  cpu_percent: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  last_sync_success: boolean;

  @ApiProperty({ example: 234 })
  @IsInt()
  @Min(0)
  last_sync_latency_ms: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  buffered_events: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  sync_error_count: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  has_screen_recording: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  has_accessibility: boolean;

  @ApiProperty({ example: 2 })
  @IsInt()
  url_detection_layer: number;
}
