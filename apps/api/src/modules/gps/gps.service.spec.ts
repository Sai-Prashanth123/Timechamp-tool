import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { GpsService } from './gps.service';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Geofence } from '../../database/entities/geofence.entity';

// ── Mock factory helpers ──────────────────────────────────────────────────

function mockRepo<T extends Record<string, any>>(): jest.Mocked<Partial<Repository<T>>> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

// ── Test suite ────────────────────────────────────────────────────────────

describe('GpsService', () => {
  let service: GpsService;
  let locationRepo: jest.Mocked<Partial<Repository<GpsLocation>>>;
  let geofenceRepo: jest.Mocked<Partial<Repository<Geofence>>>;

  beforeEach(async () => {
    locationRepo = mockRepo<GpsLocation>();
    geofenceRepo = mockRepo<Geofence>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GpsService,
        { provide: getRepositoryToken(GpsLocation), useValue: locationRepo },
        { provide: getRepositoryToken(Geofence), useValue: geofenceRepo },
      ],
    }).compile();

    service = module.get<GpsService>(GpsService);
  });

  // ── saveLocations ──────────────────────────────────────────────────────

  describe('saveLocations', () => {
    it('should store multiple GPS points and return count', async () => {
      const points = [
        { lat: 12.9716, lng: 77.5946, accuracy: 10, batteryLevel: 80, recordedAt: '2026-04-02T09:00:00Z' },
        { lat: 12.9720, lng: 77.5950, accuracy: 8, batteryLevel: 79, recordedAt: '2026-04-02T09:01:00Z' },
      ];

      const createdEntities = points.map((p) => ({
        userId: 'user-1',
        organizationId: 'org-1',
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy,
        batteryLevel: p.batteryLevel,
        recordedAt: new Date(p.recordedAt),
      }));

      (locationRepo.create as jest.Mock).mockImplementation((data) => data);
      (locationRepo.save as jest.Mock).mockResolvedValue(createdEntities);

      const count = await service.saveLocations('user-1', 'org-1', points);

      expect(locationRepo.create).toHaveBeenCalledTimes(2);
      expect(locationRepo.save).toHaveBeenCalledTimes(1);
      expect(count).toBe(2);
    });

    it('should handle nullable accuracy and batteryLevel', async () => {
      const points = [
        { lat: 12.9716, lng: 77.5946, recordedAt: '2026-04-02T09:00:00Z' },
      ];

      (locationRepo.create as jest.Mock).mockImplementation((data) => data);
      (locationRepo.save as jest.Mock).mockResolvedValue([{}]);

      const count = await service.saveLocations('user-1', 'org-1', points);

      expect(locationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ accuracy: null, batteryLevel: null }),
      );
      expect(count).toBe(1);
    });
  });

  // ── getLiveLocations ──────────────────────────────────────────────────

  describe('getLiveLocations', () => {
    it('should return most recent location per employee via subquery', async () => {
      const mockRows = [
        {
          id: 'loc-1',
          userId: 'user-1',
          organizationId: 'org-1',
          lat: '12.97160000',
          lng: '77.59460000',
          accuracy: null,
          batteryLevel: 80,
          recordedAt: new Date('2026-04-02T09:05:00Z'),
          createdAt: new Date(),
        },
      ];

      // getLiveLocations uses a raw query or subquery; mock createQueryBuilder chain
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        distinctOn: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue(mockRows),
      };
      (locationRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const results = await service.getLiveLocations('org-1');

      expect(locationRepo.createQueryBuilder).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user-1');
    });
  });

  // ── getLocations ──────────────────────────────────────────────────────

  describe('getLocations', () => {
    it('should return locations within date range scoped to userId', async () => {
      const mockLocations: GpsLocation[] = [
        {
          id: 'loc-1',
          userId: 'user-1',
          organizationId: 'org-1',
          lat: 12.9716,
          lng: 77.5946,
          accuracy: 10,
          batteryLevel: 80,
          recordedAt: new Date('2026-04-02T09:00:00Z'),
          createdAt: new Date(),
        },
      ];

      (locationRepo.find as jest.Mock).mockResolvedValue(mockLocations);

      const results = await service.getLocations('org-1', {
        from: '2026-04-02T00:00:00Z',
        to: '2026-04-02T23:59:59Z',
        userId: 'user-1',
      });

      expect(locationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            userId: 'user-1',
          }),
        }),
      );
      expect(results).toHaveLength(1);
    });

    it('should return locations for entire org when userId not provided', async () => {
      (locationRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getLocations('org-1', {
        from: '2026-04-02T00:00:00Z',
        to: '2026-04-02T23:59:59Z',
      });

      expect(locationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ userId: expect.anything() }),
        }),
      );
    });
  });

  // ── Geofence CRUD ─────────────────────────────────────────────────────

  describe('createGeofence', () => {
    it('should create and return a geofence', async () => {
      const dto = {
        name: 'HQ Office',
        lat: 12.9716,
        lng: 77.5946,
        radiusMeters: 200,
        autoClockIn: true,
        autoClockOut: false,
      };

      const created: Geofence = {
        id: 'fence-1',
        organizationId: 'org-1',
        ...dto,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (geofenceRepo.create as jest.Mock).mockReturnValue(created);
      (geofenceRepo.save as jest.Mock).mockResolvedValue(created);

      const result = await service.createGeofence('org-1', dto as any);

      expect(geofenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', name: 'HQ Office' }),
      );
      expect(result).toEqual(created);
    });
  });

  describe('updateGeofence', () => {
    it('should update fields and return updated geofence', async () => {
      const existing: Geofence = {
        id: 'fence-1',
        organizationId: 'org-1',
        name: 'Old Name',
        lat: 12.9716,
        lng: 77.5946,
        radiusMeters: 100,
        autoClockIn: false,
        autoClockOut: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (geofenceRepo.findOne as jest.Mock).mockResolvedValue(existing);
      (geofenceRepo.save as jest.Mock).mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateGeofence('org-1', 'fence-1', { name: 'New Name', radiusMeters: 300 } as any);

      expect(result.name).toBe('New Name');
      expect(result.radiusMeters).toBe(300);
    });

    it('should throw NotFoundException when geofence does not belong to org', async () => {
      (geofenceRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateGeofence('org-1', 'nonexistent', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteGeofence', () => {
    it('should delete geofence and return void', async () => {
      (geofenceRepo.findOne as jest.Mock).mockResolvedValue({ id: 'fence-1', organizationId: 'org-1' });
      (geofenceRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      await expect(service.deleteGeofence('org-1', 'fence-1')).resolves.toBeUndefined();
      expect(geofenceRepo.delete).toHaveBeenCalledWith('fence-1');
    });

    it('should throw NotFoundException when geofence not found', async () => {
      (geofenceRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteGeofence('org-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listGeofences', () => {
    it('should return all geofences for an org', async () => {
      const fences = [{ id: 'fence-1', organizationId: 'org-1', name: 'HQ' }];
      (geofenceRepo.find as jest.Mock).mockResolvedValue(fences);

      const result = await service.listGeofences('org-1');
      expect(result).toEqual(fences);
      expect(geofenceRepo.find).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  // ── checkGeofence ─────────────────────────────────────────────────────

  describe('checkGeofence', () => {
    it('should return true when point is inside radius', async () => {
      const fence: Geofence = {
        id: 'fence-1',
        organizationId: 'org-1',
        name: 'HQ',
        lat: 12.9716,
        lng: 77.5946,
        radiusMeters: 500,
        autoClockIn: false,
        autoClockOut: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (geofenceRepo.findOne as jest.Mock).mockResolvedValue(fence);

      // Point ~50m away from center — should be inside 500m radius
      const result = await service.checkGeofence('org-1', 'fence-1', 12.9720, 77.5950);

      expect(result.isInside).toBe(true);
      expect(result.distanceMeters).toBeLessThan(500);
    });

    it('should return false when point is outside radius', async () => {
      const fence: Geofence = {
        id: 'fence-1',
        organizationId: 'org-1',
        name: 'HQ',
        lat: 12.9716,
        lng: 77.5946,
        radiusMeters: 50,
        autoClockIn: false,
        autoClockOut: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (geofenceRepo.findOne as jest.Mock).mockResolvedValue(fence);

      // Point ~1km away — outside 50m radius
      const result = await service.checkGeofence('org-1', 'fence-1', 12.9800, 77.6000);

      expect(result.isInside).toBe(false);
      expect(result.distanceMeters).toBeGreaterThan(50);
    });

    it('should throw NotFoundException when geofence not found', async () => {
      (geofenceRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.checkGeofence('org-1', 'nonexistent', 12.9716, 77.5946),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── haversine unit test ────────────────────────────────────────────────

  describe('isInsideGeofence (haversine)', () => {
    it('should correctly compute ~0m distance for same point', () => {
      const dist = (service as any).haversineDistanceMeters(12.9716, 77.5946, 12.9716, 77.5946);
      expect(dist).toBeCloseTo(0, 1);
    });

    it('should compute ~111,195m per degree of latitude', () => {
      // 1 degree of latitude ≈ 111,195 m
      const dist = (service as any).haversineDistanceMeters(0, 0, 1, 0);
      expect(dist).toBeGreaterThan(111_000);
      expect(dist).toBeLessThan(111_500);
    });

    it('should compute known Bangalore distance correctly', () => {
      // Koramangala to Whitefield ≈ 15–17 km
      const dist = (service as any).haversineDistanceMeters(
        12.9352,  // Koramangala lat
        77.6245,  // Koramangala lng
        12.9698,  // Whitefield lat
        77.7500,  // Whitefield lng
      );
      expect(dist).toBeGreaterThan(12_000);
      expect(dist).toBeLessThan(18_000);
    });

    it('should return true for point clearly inside geofence', () => {
      const service_any = service as any;
      // Center: 12.9716, 77.5946. Point 10m away. Radius 100m.
      const dist = service_any.haversineDistanceMeters(12.9716, 77.5946, 12.97169, 77.59469);
      expect(dist).toBeLessThan(100);
    });

    it('should return false for point clearly outside geofence', () => {
      const service_any = service as any;
      // Center: 12.9716, 77.5946. Point ~500m away. Radius 100m.
      const dist = service_any.haversineDistanceMeters(12.9716, 77.5946, 12.9760, 77.5946);
      expect(dist).toBeGreaterThan(100);
    });
  });
});
