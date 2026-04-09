import { IsString, IsOptional, IsNumber, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrashReportDto {
  @ApiProperty({ description: 'Agent version string' })
  @IsString()
  agent_version: string;

  @ApiProperty({ description: 'Operating system: windows | darwin | linux' })
  @IsString()
  os: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  arch?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  org_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  employee_id?: string;

  @ApiProperty({ required: false, default: 'panic' })
  @IsString()
  @IsOptional()
  error_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  message?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  stack_trace?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  uptime_sec?: number;
}
