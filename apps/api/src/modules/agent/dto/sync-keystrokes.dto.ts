import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KeystrokeEventItemDto {
  @ApiProperty({ example: 42 })
  @IsInt()
  @Min(0)
  keysPerMin: number;

  @ApiProperty({ example: 17 })
  @IsInt()
  @Min(0)
  mousePerMin: number;

  @ApiProperty({ example: '2026-04-02T09:00:00.000Z' })
  @IsDateString()
  recordedAt: string;

  // Agent-provided fields — ignored server-side; identity comes from auth token.
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() orgId?: string;
}

export class SyncKeystrokesDto {
  @ApiProperty({ type: [KeystrokeEventItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeystrokeEventItemDto)
  events: KeystrokeEventItemDto[];
}
