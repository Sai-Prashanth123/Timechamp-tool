import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterAgentDto {
  @ApiProperty({ description: 'One-time invite token from email link' })
  @IsString()
  inviteToken: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  hostname?: string;

  @ApiProperty({ required: false, description: 'windows | darwin | linux' })
  @IsString()
  @IsOptional()
  os?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  osVersion?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  agentVersion?: string;
}
