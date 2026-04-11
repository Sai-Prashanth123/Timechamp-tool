import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Heartbeat request body.
 *
 * The Go agent sends this every 30–60 seconds. The `idle` flag is the agent's
 * own AFK self-report (derived from its 3-sample-median idle detector) and is
 * used to flip the live-monitoring presence badge between 'online' and 'idle'
 * without waiting for the next activity event.
 */
export class HeartbeatDto {
  @ApiPropertyOptional({ example: false, description: 'Agent AFK state at time of heartbeat' })
  @IsOptional()
  @IsBoolean()
  idle?: boolean;
}
