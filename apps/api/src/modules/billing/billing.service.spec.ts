import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Organization } from '../../database/entities/organization.entity';
import { ConfigService } from '@nestjs/config';

const mockSubRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};
const mockOrgRepo = { findOne: jest.fn() };
const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_WEBHOOK_SECRET: 'whsec_mock',
      STRIPE_PRICE_STARTER: 'price_starter',
      STRIPE_PRICE_PRO: 'price_pro',
      STRIPE_PRICE_ENTERPRISE: 'price_enterprise',
      APP_URL: 'http://localhost:3001',
    };
    return map[key];
  }),
};

describe('BillingService.getPlanName', () => {
  let service: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<BillingService>(BillingService);
  });

  it('returns starter for starter price ID', () => {
    expect(service.getPlanName('price_starter')).toBe('starter');
  });

  it('returns pro for pro price ID', () => {
    expect(service.getPlanName('price_pro')).toBe('pro');
  });

  it('returns enterprise for enterprise price ID', () => {
    expect(service.getPlanName('price_enterprise')).toBe('enterprise');
  });

  it('returns null for unknown price ID', () => {
    expect(service.getPlanName('price_unknown')).toBeNull();
  });
});
