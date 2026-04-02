import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsInt,
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

  @ApiProperty({ example: 120 })
  @IsInt()
  @Min(0)
  durationSec: number;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @IsInt()
  @Min(0)
  keystrokeCount?: number;
}

export class SyncActivityDto {
  @ApiProperty({ type: [ActivityEventItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityEventItemDto)
  events: ActivityEventItemDto[];
}
