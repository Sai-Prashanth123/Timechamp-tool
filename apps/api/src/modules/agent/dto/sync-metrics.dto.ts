import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';

export class MetricsEventDto {
  @IsString() employeeId: string;
  @IsString() orgId: string;
  @IsNumber() cpuPercent: number;
  @IsNumber() memUsedMb: number;
  @IsNumber() memTotalMb: number;
  @IsNumber() agentCpuPercent: number;
  @IsNumber() agentMemMb: number;
  @IsDateString() recordedAt: string;
}

export class SyncMetricsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetricsEventDto)
  events: MetricsEventDto[];
}
