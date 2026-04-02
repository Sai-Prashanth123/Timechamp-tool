import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetLocationsQueryDto {
  @ApiProperty({ example: '2026-04-01T00:00:00Z' })
  @IsISO8601()
  from: string;

  @ApiProperty({ example: '2026-04-02T23:59:59Z' })
  @IsISO8601()
  to: string;

  @ApiPropertyOptional({ description: 'Filter to a single user (managers see all)' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
