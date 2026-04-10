// apps/api/src/modules/alerts/alerts.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertRule, AlertType } from '../../database/entities/alert-rule.entity';
import { AlertEvent } from '../../database/entities/alert-event.entity';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';

// ── Mock helpers ──────────────────────────────────────────────────────

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
};

function mockRepo(): MockRepo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  } as unknown as MockRepo;
}

const mockMailer = { sendAlertEmail: jest.fn().mockResolvedValue(undefined) };
const mockGateway = { emitAlertNew: jest.fn() };

// ── Tests ─────────────────────────────────────────────────────────────

describe('AlertsService', () => {
  let service: AlertsService;
  let ruleRepo: MockRepo;
  let eventRepo: MockRepo;

  const ORG      = 'org-uuid-1';
  const RULE_ID  = 'rule-uuid-1';
  const EVENT_ID = 'event-uuid-1';
  const USER_ID  = 'user-uuid-1';

  beforeEach(async () => {
    ruleRepo  = mockRepo();
    eventRepo = mockRepo();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(AlertRule),  useValue: ruleRepo  },
        { provide: getRepositoryToken(AlertEvent), useValue: eventRepo },
        { provide: MailerService,     useValue: mockMailer  },
        { provide: MonitoringGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
  });

  // ── getRules ─────────────────────────────────────────────────────────

  it('getRules returns rules for org ordered by createdAt desc', async () => {
    const rules: Partial<AlertRule>[] = [
      { id: RULE_ID, organizationId: ORG, name: 'Idle Alert', type: AlertType.IDLE_TOO_LONG, threshold: 30, enabled: true },
    ];
    ruleRepo.find.mockResolvedValue(rules);

    const result = await service.getRules(ORG);

    expect(ruleRepo.find).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      order: { createdAt: 'DESC' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Idle Alert');
  });

  // ── createRule ────────────────────────────────────────────────────────

  it('createRule persists and returns rule', async () => {
    const dto = {
      name: 'Overtime Alert',
      type: AlertType.OVERTIME,
      threshold: 480,
      notifyEmail: true,
      notifyInApp: true,
    };
    const saved: Partial<AlertRule> = { id: RULE_ID, organizationId: ORG, ...dto, enabled: true };
    ruleRepo.create.mockReturnValue(saved);
    ruleRepo.save.mockResolvedValue(saved);

    const result = await service.createRule(ORG, dto);

    expect(ruleRepo.create).toHaveBeenCalledWith({
      organizationId: ORG,
      name: dto.name,
      type: dto.type,
      threshold: dto.threshold,
      enabled: true,
      notifyEmail: true,
      notifyInApp: true,
    });
    expect(ruleRepo.save).toHaveBeenCalledWith(saved);
    expect(result.id).toBe(RULE_ID);
  });

  // ── updateRule ────────────────────────────────────────────────────────

  it('updateRule patches existing rule', async () => {
    const existing: Partial<AlertRule> = {
      id: RULE_ID, organizationId: ORG,
      name: 'Old Name', type: AlertType.IDLE_TOO_LONG, threshold: 30, enabled: true,
    };
    ruleRepo.findOne.mockResolvedValue(existing);
    ruleRepo.save.mockImplementation(async (r: any) => r);

    const result = await service.updateRule(RULE_ID, ORG, { name: 'New Name', threshold: 45 });

    expect(result.name).toBe('New Name');
    expect(result.threshold).toBe(45);
  });

  it('updateRule throws NotFoundException when rule missing', async () => {
    ruleRepo.findOne.mockResolvedValue(null);
    await expect(service.updateRule('bad-id', ORG, {})).rejects.toThrow(NotFoundException);
  });

  // ── deleteRule ────────────────────────────────────────────────────────

  it('deleteRule removes rule from org', async () => {
    ruleRepo.findOne.mockResolvedValue({ id: RULE_ID, organizationId: ORG });
    ruleRepo.delete.mockResolvedValue({ affected: 1 });

    await service.deleteRule(RULE_ID, ORG);

    expect(ruleRepo.delete).toHaveBeenCalledWith({ id: RULE_ID, organizationId: ORG });
  });

  it('deleteRule throws NotFoundException for unknown rule', async () => {
    ruleRepo.findOne.mockResolvedValue(null);
    await expect(service.deleteRule('bad-id', ORG)).rejects.toThrow(NotFoundException);
  });

  // ── getEvents ─────────────────────────────────────────────────────────

  it('getEvents with no userId returns all org events', async () => {
    const events: Partial<AlertEvent>[] = [
      { id: EVENT_ID, organizationId: ORG, userId: USER_ID, type: AlertType.IDLE_TOO_LONG },
    ];
    eventRepo.find.mockResolvedValue(events);

    const result = await service.getEvents(ORG);

    expect(eventRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );
    expect(result).toHaveLength(1);
  });

  it('getEvents with userId filters to that user', async () => {
    eventRepo.find.mockResolvedValue([]);

    await service.getEvents(ORG, USER_ID);

    expect(eventRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, userId: USER_ID } }),
    );
  });

  // ── markSeen ──────────────────────────────────────────────────────────

  it('markSeen sets seenAt timestamp', async () => {
    const event: Partial<AlertEvent> = { id: EVENT_ID, organizationId: ORG, seenAt: null };
    eventRepo.findOne.mockResolvedValue(event);
    eventRepo.save.mockImplementation(async (e: any) => e);

    const result = await service.markSeen(EVENT_ID, ORG);

    expect(result.seenAt).toBeDefined();
  });

  it('markSeen throws NotFoundException for unknown event', async () => {
    eventRepo.findOne.mockResolvedValue(null);
    await expect(service.markSeen('bad-id', ORG)).rejects.toThrow(NotFoundException);
  });

  // ── getUnreadCount ────────────────────────────────────────────────────

  it('getUnreadCount returns count of unseen events for user', async () => {
    eventRepo.count.mockResolvedValue(3);

    const count = await service.getUnreadCount(ORG, USER_ID);

    expect(eventRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG, userId: USER_ID }),
      }),
    );
    expect(count).toBe(3);
  });

  // ── fireAlert ─────────────────────────────────────────────────────────

  it('fireAlert inserts event and calls mailer + gateway when notifyEmail=true', async () => {
    const rule: Partial<AlertRule> = {
      id: RULE_ID,
      organizationId: ORG,
      name: 'Idle Alert',
      type: AlertType.IDLE_TOO_LONG,
      threshold: 30,
      notifyEmail: true,
      notifyInApp: true,
      enabled: true,
    };
    const savedEvent: Partial<AlertEvent> = {
      id: EVENT_ID,
      organizationId: ORG,
      userId: USER_ID,
      type: AlertType.IDLE_TOO_LONG,
      message: 'Employee idle for 35 minutes (threshold: 30 min)',
      triggeredAt: new Date(),
    };
    eventRepo.create.mockReturnValue(savedEvent);
    eventRepo.save.mockResolvedValue(savedEvent);

    await service.fireAlert(rule as AlertRule, USER_ID, 'Employee idle for 35 minutes (threshold: 30 min)', 'employee@test.com', 'Jane Doe');

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        userId: USER_ID,
        ruleId: RULE_ID,
        type: AlertType.IDLE_TOO_LONG,
        message: 'Employee idle for 35 minutes (threshold: 30 min)',
      }),
    );
    expect(mockMailer.sendAlertEmail).toHaveBeenCalledWith(
      'employee@test.com',
      'Idle Alert',
      'Employee idle for 35 minutes (threshold: 30 min)',
      'Jane Doe',
    );
    expect(mockGateway.emitAlertNew).toHaveBeenCalledWith(ORG, expect.objectContaining({ eventId: EVENT_ID }));
  });

  it('fireAlert skips email when notifyEmail=false', async () => {
    const rule: Partial<AlertRule> = {
      id: RULE_ID,
      organizationId: ORG,
      name: 'Silent Alert',
      type: AlertType.OVERTIME,
      threshold: 480,
      notifyEmail: false,
      notifyInApp: true,
      enabled: true,
    };
    eventRepo.create.mockReturnValue({});
    eventRepo.save.mockResolvedValue({ id: EVENT_ID, organizationId: ORG, userId: USER_ID, triggeredAt: new Date() });

    await service.fireAlert(rule as AlertRule, USER_ID, 'Overtime message', 'emp@test.com', 'Bob');

    expect(mockMailer.sendAlertEmail).not.toHaveBeenCalled();
    expect(mockGateway.emitAlertNew).toHaveBeenCalled();
  });
});
