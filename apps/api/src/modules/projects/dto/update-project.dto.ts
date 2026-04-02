import {
  IsString,
  IsOptional,
  IsISO8601,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Website Redesign v2' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['active', 'completed', 'on_hold', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'completed', 'on_hold', 'archived'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deadline?: string | null;
}
