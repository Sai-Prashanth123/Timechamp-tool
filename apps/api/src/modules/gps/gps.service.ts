import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Geofence } from '../../database/entities/geofence.entity';
import { GetLocationsQueryDto } from './dto/get-locations-query.dto';
import { CreateGeofenceDto } from './dto/create-geofence.dto';
import { UpdateGeofenceDto } from './dto/update-geofence.dto';

export interface GpsPointInput {
  lat: number;
  lng: number;
  accuracy?: number;
  batteryLevel?: number;
  recordedAt: string;
}

export interface CheckGeofenceResult {
  isInside: boolean;
  distanceMeters: number;
  geofence: Geofence;
}

@Injectable()
export class GpsService {
  constructor(
    @InjectRepository(GpsLocation)
    private locationRepo: Repository<GpsLocation>,
    @InjectRepository(Geofence)
    private geofenceRepo: Repository<Geofence>,
  ) {}

  // ── Haversine helper ────────────────────────────────────────────────

  private haversineDistanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6_371_000; // Earth radius in metres
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  // ── Location ingestion ──────────────────────────────────────────────

  async saveLocations(
    userId: string,
    organizationId: string,
    points: GpsPointInput[],
  ): Promise<number> {
    const entities = points.map((p) =>
      this.locationRepo.create({
        userId,
        organizationId,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy ?? null,
        batteryLevel: p.batteryLevel ?? null,
        recordedAt: new Date(p.recordedAt),
      }),
    );
    await this.locationRepo.save(entities);
    return entities.length;
  }

  // ── Live locations (most recent per employee) ───────────────────────

  async getLiveLocations(organizationId: string): Promise<GpsLocation[]> {
    return this.locationRepo
      .createQueryBuilder('loc')
      .distinctOn(['loc.userId'])
      .where('loc.organizationId = :organizationId', { organizationId })
      .orderBy('loc.userId', 'ASC')
      .addOrderBy('loc.recordedAt', 'DESC')
      .getMany();
  }

  // ── History with date-range + optional userId filter ────────────────

  async getLocations(
    organizationId: string,
    query: GetLocationsQueryDto,
  ): Promise<GpsLocation[]> {
    const where: Record<string, unknown> = {
      organizationId,
      recordedAt: Between(new Date(query.from), new Date(query.to)),
    };

    if (query.userId) {
      where['userId'] = query.userId;
    }

    return this.locationRepo.find({
      where,
      order: { recordedAt: 'DESC' },
      take: 1000, // hard cap — prevent accidental huge payloads
    });
  }

  // ── Geofence CRUD ───────────────────────────────────────────────────

  async listGeofences(organizationId: string): Promise<Geofence[]> {
    return this.geofenceRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createGeofence(
    organizationId: string,
    dto: CreateGeofenceDto,
  ): Promise<Geofence> {
    const entity = this.geofenceRepo.create({
      organizationId,
      name: dto.name,
      lat: dto.lat,
      lng: dto.lng,
      radiusMeters: dto.radiusMeters ?? 100,
      autoClockIn: dto.autoClockIn ?? false,
      autoClockOut: dto.autoClockOut ?? false,
    });
    return this.geofenceRepo.save(entity);
  }

  async updateGeofence(
    organizationId: string,
    geofenceId: string,
    dto: UpdateGeofenceDto,
  ): Promise<Geofence> {
    const fence = await this.geofenceRepo.findOne({
      where: { id: geofenceId, organizationId },
    });
    if (!fence) {
      throw new NotFoundException(`Geofence ${geofenceId} not found`);
    }

    if (dto.name !== undefined) fence.name = dto.name;
    if (dto.lat !== undefined) fence.lat = dto.lat;
    if (dto.lng !== undefined) fence.lng = dto.lng;
    if (dto.radiusMeters !== undefined) fence.radiusMeters = dto.radiusMeters;
    if (dto.autoClockIn !== undefined) fence.autoClockIn = dto.autoClockIn;
    if (dto.autoClockOut !== undefined) fence.autoClockOut = dto.autoClockOut;
    if (dto.isActive !== undefined) fence.isActive = dto.isActive;

    return this.geofenceRepo.save(fence);
  }

  async deleteGeofence(
    organizationId: string,
    geofenceId: string,
  ): Promise<void> {
    const fence = await this.geofenceRepo.findOne({
      where: { id: geofenceId, organizationId },
    });
    if (!fence) {
      throw new NotFoundException(`Geofence ${geofenceId} not found`);
    }
    await this.geofenceRepo.delete(geofenceId);
  }

  // ── Geofence point-in-circle check ─────────────────────────────────

  async checkGeofence(
    organizationId: string,
    geofenceId: string,
    lat: number,
    lng: number,
  ): Promise<CheckGeofenceResult> {
    const fence = await this.geofenceRepo.findOne({
      where: { id: geofenceId, organizationId },
    });
    if (!fence) {
      throw new NotFoundException(`Geofence ${geofenceId} not found`);
    }

    const distanceMeters = this.haversineDistanceMeters(
      Number(fence.lat),
      Number(fence.lng),
      lat,
      lng,
    );

    return {
      isInside: distanceMeters <= fence.radiusMeters,
      distanceMeters: Math.round(distanceMeters * 100) / 100,
      geofence: fence,
    };
  }
}
