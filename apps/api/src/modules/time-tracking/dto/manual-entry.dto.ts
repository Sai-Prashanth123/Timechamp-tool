import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ManualEntryDto {
  @ApiProperty({ example: '2026-04-01T09:00:00.000Z' })
  @IsISO8601()
  startedAt: string;

  @ApiProperty({ example: '2026-04-01T17:00:00.000Z' })
  @IsISO8601()
  endedAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
