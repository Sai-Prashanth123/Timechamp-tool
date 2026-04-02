import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Geofence } from '../../database/entities/geofence.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GpsLocation, Geofence])],
  controllers: [GpsController],
  providers: [GpsService],
  exports: [GpsService],
})
export class GpsModule {}
