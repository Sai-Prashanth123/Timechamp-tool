import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertsService } from './alerts.service';
import { AlertRule } from '../../database/entities/alert-rule.entity';
import { AlertEvent } from '../../database/entities/alert-event.entity';

const mockRulesRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() };
const mockEventsRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn(), count: jest.fn() };

describe('AlertsService', () => {
  let service: AlertsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(AlertRule), useValue: mockRulesRepo },
        { provide: getRepositoryToken(AlertEvent), useValue: mockEventsRepo },
      ],
    }).compile();
    service = module.get(AlertsService);
    jest.clearAllMocks();
  });

  it('getRules returns rules for org', async () => {
    mockRulesRepo.find.mockResolvedValue([{ id: 'r1', name: 'Idle Alert' }]);
    const result = await service.getRules('org1');
    expect(result).toHaveLength(1);
    expect(mockRulesRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org1' } }));
  });

  it('createRule saves and returns rule', async () => {
    const rule = { id: 'r1', organizationId: 'org1', name: 'Test', type: 'idle_too_long', threshold: 30 };
    mockRulesRepo.create.mockReturnValue(rule);
    mockRulesRepo.save.mockResolvedValue(rule);
    const result = await service.createRule('org1', { name: 'Test', type: 'idle_too_long', threshold: 30 });
    expect(result.name).toBe('Test');
  });

  it('fireAlert creates and saves event', async () => {
    const event = { id: 'e1', type: 'idle_too_long', message: 'Idle for 30 min', organizationId: 'org1', userId: 'u1' };
    mockEventsRepo.create.mockReturnValue(event);
    mockEventsRepo.save.mockResolvedValue(event);
    const result = await service.fireAlert('org1', 'u1', 'idle_too_long', 'Idle for 30 min');
    expect(result.type).toBe('idle_too_long');
  });

  it('getUnreadCount counts unseenAt=null events', async () => {
    mockEventsRepo.count.mockResolvedValue(5);
    const count = await service.getUnreadCount('org1', 'u1');
    expect(count).toBe(5);
  });

  it('markSeen updates seenAt', async () => {
    mockEventsRepo.update.mockResolvedValue({});
    await service.markSeen('e1');
    expect(mockEventsRepo.update).toHaveBeenCalledWith('e1', expect.objectContaining({ seenAt: expect.any(Date) }));
  });
});
