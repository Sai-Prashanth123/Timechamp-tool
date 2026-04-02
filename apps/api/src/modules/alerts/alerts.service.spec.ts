import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertRule } from './alert-rule.entity';
import { AlertEvent } from './alert-event.entity';

// ── Mock helpers ───────────────────────────────────────────────────────

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};

function mockRepo(): MockRepo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  } as unknown as MockRepo;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('AlertsService', () => {
  let service: AlertsService;
  let ruleRepo: MockRepo;
  let eventRepo: MockRepo;

  const ORG = 'org-1';
  const RULE_ID = 'rule-1';
  const EVENT_ID = 'event-1';
  const USER_ID = 'user-1';

  beforeEach(async () => {
    ruleRepo = mockRepo();
    eventRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(AlertRule), useValue: ruleRepo },
        { provide: getRepositoryToken(AlertEvent), useValue: eventRepo },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
    jest.clearAllMocks();
  });

  // ── listRules ──────────────────────────────────────────────────────

  it('listRules returns rules for org', async () => {
    const rules: Partial<AlertRule>[] = [
      { id: RULE_ID, organizationId: ORG, name: 'Idle Time Alert', metric: 'idle_time', thresholdMinutes: 30, isActive: true },
    ];
    ruleRepo.find.mockResolvedValue(rules);

    const result = await service.listRules(ORG);

    expect(ruleRepo.find).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      order: { createdAt: 'DESC' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Idle Time Alert');
  });

  // ── createRule ─────────────────────────────────────────────────────

  it('createRule creates and returns rule', async () => {
    const dto = { name: 'No Activity Alert', metric: 'no_activity', thresholdMinutes: 60 };
    const saved: Partial<AlertRule> = { id: RULE_ID, organizationId: ORG, ...dto, isActive: true };
    ruleRepo.create.mockReturnValue(saved);
    ruleRepo.save.mockResolvedValue(saved);

    const result = await service.createRule(ORG, dto);

    expect(ruleRepo.create).toHaveBeenCalledWith({
      organizationId: ORG,
      name: dto.name,
      metric: dto.metric,
      thresholdMinutes: dto.thresholdMinutes,
      isActive: true,
    });
    expect(ruleRepo.save).toHaveBeenCalledWith(saved);
    expect(result.id).toBe(RULE_ID);
  });

  // ── updateRule ─────────────────────────────────────────────────────

  it('updateRule updates existing rule', async () => {
    const existing: Partial<AlertRule> = {
      id: RULE_ID,
      organizationId: ORG,
      name: 'Old Name',
      metric: 'idle_time',
      thresholdMinutes: 30,
      isActive: true,
    };
    ruleRepo.findOne.mockResolvedValue(existing);
    ruleRepo.save.mockResolvedValue({ ...existing, name: 'New Name', thresholdMinutes: 45 });

    const result = await service.updateRule(RULE_ID, ORG, { name: 'New Name', thresholdMinutes: 45 });

    expect(ruleRepo.findOne).toHaveBeenCalledWith({ where: { id: RULE_ID, organizationId: ORG } });
    expect(result.name).toBe('New Name');
    expect(result.thresholdMinutes).toBe(45);
  });

  // ── deleteRule ─────────────────────────────────────────────────────

  it('deleteRule removes rule from org', async () => {
    ruleRepo.findOne.mockResolvedValue({ id: RULE_ID, organizationId: ORG });
    ruleRepo.delete.mockResolvedValue({ affected: 1 });

    await service.deleteRule(RULE_ID, ORG);

    expect(ruleRepo.delete).toHaveBeenCalledWith({ id: RULE_ID, organizationId: ORG });
  });

  it('deleteRule throws NotFoundException for wrong org', async () => {
    ruleRepo.findOne.mockResolvedValue(null);

    await expect(service.deleteRule('missing-id', ORG)).rejects.toThrow(NotFoundException);
  });

  // ── listEvents ─────────────────────────────────────────────────────

  it('listEvents returns events ordered by triggered_at desc', async () => {
    const events: Partial<AlertEvent>[] = [
      { id: EVENT_ID, organizationId: ORG, metric: 'idle_time', valueMinutes: 35, thresholdMinutes: 30 },
    ];
    eventRepo.find.mockResolvedValue(events);

    const result = await service.listEvents(ORG);

    expect(eventRepo.find).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      order: { triggeredAt: 'DESC' },
      take: 50,
    });
    expect(result).toHaveLength(1);
    expect(result[0].metric).toBe('idle_time');
  });

  // ── acknowledgeEvent ───────────────────────────────────────────────

  it('acknowledgeEvent sets acknowledgedAt and acknowledgedBy', async () => {
    const event: Partial<AlertEvent> = {
      id: EVENT_ID,
      organizationId: ORG,
      metric: 'idle_time',
      valueMinutes: 35,
      thresholdMinutes: 30,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
    eventRepo.findOne.mockResolvedValue(event);
    eventRepo.save.mockImplementation(async (e: any) => e);

    const result = await service.acknowledgeEvent(EVENT_ID, ORG, USER_ID);

    expect(result.acknowledgedAt).toBeDefined();
    expect(result.acknowledgedBy).toBe(USER_ID);
  });

  it('acknowledgeEvent throws NotFoundException for unknown event', async () => {
    eventRepo.findOne.mockResolvedValue(null);

    await expect(service.acknowledgeEvent('missing-id', ORG, USER_ID)).rejects.toThrow(NotFoundException);
  });
});
