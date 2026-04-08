import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentService } from './agent.service';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { User } from '../../database/entities/user.entity';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Organization } from '../../database/entities/organization.entity';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

const mockUser = { id: 'user-uuid', organizationId: 'org-uuid', isActive: true };

const mockTokenService = { peek: jest.fn() };
const mockDeviceRepo = {
  findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn(),
};
const mockUserRepo = { findOne: jest.fn() };
const mockOrgRepo = { findOne: jest.fn() };
const mockActivityRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn() };
const mockScreenshotRepo = { create: jest.fn(), save: jest.fn() };
const mockGpsRepo = { create: jest.fn(), save: jest.fn() };
const mockConfig = { get: jest.fn((k: string) => k === 'AWS_REGION' ? 'us-east-1' : undefined) };

async function buildModule() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AgentService,
      { provide: getRepositoryToken(AgentDevice), useValue: mockDeviceRepo },
      { provide: getRepositoryToken(User), useValue: mockUserRepo },
      { provide: getRepositoryToken(ActivityEvent), useValue: mockActivityRepo },
      { provide: getRepositoryToken(Screenshot), useValue: mockScreenshotRepo },
      { provide: getRepositoryToken(GpsLocation), useValue: mockGpsRepo },
      { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
      { provide: ConfigService, useValue: mockConfig },
      { provide: 'TOKEN_SERVICE', useValue: mockTokenService },
    ],
  }).compile();
  return module.get<AgentService>(AgentService);
}

describe('AgentService.registerAgent', () => {
  let service: AgentService;
  beforeEach(async () => { service = await buildModule(); jest.clearAllMocks(); });

  it('returns agentToken + employeeId + orgId on valid invite token', async () => {
    mockTokenService.peek.mockResolvedValue('user-uuid');
    mockUserRepo.findOne.mockResolvedValue(mockUser);
    mockDeviceRepo.create.mockReturnValue({ deviceToken: 'gen-token' });
    mockDeviceRepo.save.mockResolvedValue({ deviceToken: 'gen-token' });

    const result = await service.registerAgent({ inviteToken: 'valid' });
    expect(result.employeeId).toBe('user-uuid');
    expect(result.orgId).toBe('org-uuid');
    expect(typeof result.agentToken).toBe('string');
  });

  it('throws UnauthorizedException when invite token invalid', async () => {
    mockTokenService.peek.mockResolvedValue(null);
    await expect(service.registerAgent({ inviteToken: 'bad' })).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user not found', async () => {
    mockTokenService.peek.mockResolvedValue('user-uuid');
    mockUserRepo.findOne.mockResolvedValue(null);
    await expect(service.registerAgent({ inviteToken: 'valid' })).rejects.toThrow(UnauthorizedException);
  });
});

describe('AgentService.recordHeartbeat', () => {
  let service: AgentService;
  beforeEach(async () => { service = await buildModule(); jest.clearAllMocks(); });

  it('updates last_seen_at for active device', async () => {
    mockDeviceRepo.update.mockResolvedValue({ affected: 1 });
    await service.recordHeartbeat(mockUser as any);
    expect(mockDeviceRepo.update).toHaveBeenCalledWith(
      { userId: 'user-uuid', isActive: true },
      expect.objectContaining({ lastSeenAt: expect.any(Date) }),
    );
  });
});
