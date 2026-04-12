import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Compact projection of the authenticated AgentDevice, as stashed on the
 * request by AgentAuthGuard. Only the fields downstream code actually reads
 * — keeps the Redis cache payload small.
 */
export interface AgentDeviceContext {
  id: string;
  displayName: string | null;
  hostname: string | null;
}

export const AgentCurrentDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AgentDeviceContext =>
    ctx.switchToHttp().getRequest().device,
);
