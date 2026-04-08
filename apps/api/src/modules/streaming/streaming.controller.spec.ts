import { Test, TestingModule } from '@nestjs/testing';
import { StreamingController } from './streaming.controller';
import { StreamingService } from './streaming.service';
import { StreamingGateway } from './streaming.gateway';
import { NotFoundException } from '@nestjs/common';

const mockService = {
  getActiveSessions: jest.fn(),
  getSessionByUserId: jest.fn(),
  updateSessionMode: jest.fn(),
  getSessionStats: jest.fn(),
  getOrgStreamingConfig: jest.fn(),
  updateOrgStreamingConfig: jest.fn(),
};

const mockGateway = {
  sendControlToAgent: jest.fn(),
};

describe('StreamingController.requestStream', () => {
  let controller: StreamingController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StreamingController],
      providers: [
        { provide: StreamingService, useValue: mockService },
        { provide: StreamingGateway, useValue: mockGateway },
      ],
    }).compile();
    controller = module.get<StreamingController>(StreamingController);
  });

  it('returns accepted:true when agent is connected', async () => {
    mockGateway.sendControlToAgent.mockReturnValue(true);
    const user = { id: 'manager1', organizationId: 'org1' } as any;
    const result = await controller.requestStream('user1', user);
    expect(result).toEqual({ accepted: true, userId: 'user1' });
    expect(mockGateway.sendControlToAgent).toHaveBeenCalledWith('user1', { action: 'start_stream', requestedBy: 'manager1' });
  });

  it('throws NotFoundException when agent is not connected and no session', async () => {
    mockGateway.sendControlToAgent.mockReturnValue(false);
    mockService.getSessionByUserId.mockResolvedValue(null);
    const user = { id: 'manager1', organizationId: 'org1' } as any;
    await expect(controller.requestStream('user1', user)).rejects.toThrow(NotFoundException);
  });

  it('stopStream returns accepted:true when agent is connected', async () => {
    mockGateway.sendControlToAgent.mockReturnValue(true);
    const user = { id: 'manager1', organizationId: 'org1' } as any;
    const result = await controller.stopStream('user1', user);
    expect(result).toEqual({ accepted: true, userId: 'user1' });
    expect(mockGateway.sendControlToAgent).toHaveBeenCalledWith('user1', { action: 'stop_stream', requestedBy: 'manager1' });
  });

  it('stopStream throws NotFoundException when agent not connected', async () => {
    mockGateway.sendControlToAgent.mockReturnValue(false);
    const user = { id: 'manager1', organizationId: 'org1' } as any;
    await expect(controller.stopStream('user1', user)).rejects.toThrow(NotFoundException);
  });
});
