import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ClockOutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
