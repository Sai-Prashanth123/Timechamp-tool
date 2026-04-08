import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AgentAuthGuard } from './agent-auth.guard';

const mockAgentService = {
  findDeviceByToken: jest.fn(),
};

const mockUserRepo = {
  findOne: jest.fn(),
};

const mockDevice = { userId: 'user-123' };
const mockUser = { id: 'user-123', isActive: true };

function makeContext(headers: Record<string, string>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, agentUser: undefined } as any),
    }),
  } as unknown as ExecutionContext;
}

describe('AgentAuthGuard', () => {
  let guard: AgentAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AgentAuthGuard(
      mockAgentService as any,
      mockUserRepo as any,
    );
  });

  it('resolves user from Authorization: Bearer header and sets request.agentUser', async () => {
    mockAgentService.findDeviceByToken.mockResolvedValue(mockDevice);
    mockUserRepo.findOne.mockResolvedValue(mockUser);

    const req: any = { headers: { authorization: 'Bearer valid-token' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockAgentService.findDeviceByToken).toHaveBeenCalledWith('valid-token');
    expect(req.agentUser).toEqual(mockUser);
  });

  it('resolves user from X-Device-Token header', async () => {
    mockAgentService.findDeviceByToken.mockResolvedValue(mockDevice);
    mockUserRepo.findOne.mockResolvedValue(mockUser);

    const req: any = { headers: { 'x-device-token': 'device-abc' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockAgentService.findDeviceByToken).toHaveBeenCalledWith('device-abc');
    expect(req.agentUser).toEqual(mockUser);
  });

  it('throws UnauthorizedException when no token provided', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when device token is invalid', async () => {
    mockAgentService.findDeviceByToken.mockResolvedValue(null);
    const ctx = makeContext({ 'x-device-token': 'bad-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user is inactive', async () => {
    mockAgentService.findDeviceByToken.mockResolvedValue(mockDevice);
    mockUserRepo.findOne.mockResolvedValue({ id: 'user-123', isActive: false });
    const ctx = makeContext({ 'x-device-token': 'valid-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
