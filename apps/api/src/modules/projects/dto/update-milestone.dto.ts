import {
  IsString,
  IsOptional,
  IsISO8601,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMilestoneDto {
  @ApiPropertyOptional({ example: 'General Availability' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: '2026-07-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @ApiPropertyOptional({
    description: 'Set true to mark complete (sets completedAt to now); false to un-complete',
  })
  @IsOptional()
  @IsBoolean()
  markComplete?: boolean;
}
