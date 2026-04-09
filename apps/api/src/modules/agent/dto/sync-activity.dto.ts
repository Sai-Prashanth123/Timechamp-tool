import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActivityEventItemDto {
  @ApiProperty({ example: 'Visual Studio Code' })
  @IsString()
  appName: string;

  @ApiPropertyOptional({ example: 'main.go — myproject' })
  @IsOptional()
  @IsString()
  windowTitle?: string;

  @ApiProperty({ example: '2026-04-02T09:00:00.000Z' })
  @IsISO8601()
  startedAt: string;

  @ApiPropertyOptional({ example: '2026-04-02T09:02:00.000Z' })
  @IsOptional()
  @IsISO8601()
  endedAt?: string;

  /** Duration in seconds (dashboard/legacy format) */
  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;

  /** Duration in milliseconds (agent format) — converted to seconds server-side */
  @ApiPropertyOptional({ example: 120000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  durationMs?: number;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @IsInt()
  @Min(0)
  keystrokeCount?: number;

  // Agent-provided fields (ignored server-side; identity comes from auth token)
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() orgId?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() category?: string;
}

export class SyncActivityDto {
  @ApiProperty({ type: [ActivityEventItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityEventItemDto)
  events: ActivityEventItemDto[];
}
