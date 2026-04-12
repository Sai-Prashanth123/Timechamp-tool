import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Accepts either:
 *   - `inviteToken`   — legacy one-time email-invite flow (still supported)
 *   - `personalToken` — new per-user reusable token generated from the
 *                       dashboard at /settings/agent and pasted into the
 *                       agent's setup UI
 *
 * The service validates that exactly one of the two is present.
 */
export class RegisterAgentDto {
  @ApiProperty({ required: false, description: 'Legacy one-time invite token from email link' })
  @IsString()
  @IsOptional()
  inviteToken?: string;

  @ApiProperty({ required: false, description: 'Reusable personal agent token generated from /settings/agent' })
  @IsUUID()
  @IsOptional()
  personalToken?: string;

  @ApiProperty({ required: false, description: 'Human-friendly label shown on the dashboard (e.g. "Sai\'s Laptop")' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  displayName?: string;

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
