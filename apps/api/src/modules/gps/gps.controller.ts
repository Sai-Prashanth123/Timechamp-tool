import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { GpsService } from './gps.service';
import { GetLocationsQueryDto } from './dto/get-locations-query.dto';
import { CreateGeofenceDto } from './dto/create-geofence.dto';
import { UpdateGeofenceDto } from './dto/update-geofence.dto';
import { CheckGeofenceDto } from './dto/check-geofence.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('GPS')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gps')
export class GpsController {
  constructor(private readonly gpsService: GpsService) {}

  // ── Location history ──────────────────────────────────────────────

  @Get('locations')
  @ApiOperation({ summary: 'Get GPS location history (requires from/to query params)' })
  async getLocations(
    @CurrentUser() user: User,
    @Query() query: GetLocationsQueryDto,
  ) {
    // Employees can only see their own; managers/admins can filter by userId or see all
    const effectiveQuery =
      user.role === UserRole.EMPLOYEE
        ? { ...query, userId: user.id }
        : query;

    return this.gpsService.getLocations(user.organizationId, effectiveQuery);
  }

  // ── Live locations (most recent per employee) ─────────────────────

  @Get('locations/live')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get most recent GPS location per employee (admin/manager only)' })
  async getLiveLocations(@CurrentUser() user: User) {
    return this.gpsService.getLiveLocations(user.organizationId);
  }

  // ── Geofences ─────────────────────────────────────────────────────

  @Get('geofences')
  @ApiOperation({ summary: 'List all geofences for the organization' })
  async listGeofences(@CurrentUser() user: User) {
    return this.gpsService.listGeofences(user.organizationId);
  }

  @Post('geofences')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new geofence (admin/manager only)' })
  async createGeofence(
    @CurrentUser() user: User,
    @Body() dto: CreateGeofenceDto,
  ) {
    return this.gpsService.createGeofence(user.organizationId, dto);
  }

  @Patch('geofences/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Update a geofence (admin/manager only)' })
  async updateGeofence(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGeofenceDto,
  ) {
    return this.gpsService.updateGeofence(user.organizationId, id, dto);
  }

  @Delete('geofences/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a geofence (admin/manager only)' })
  async deleteGeofence(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.gpsService.deleteGeofence(user.organizationId, id);
  }

  @Post('geofences/:id/check')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Check if a lat/lng point is inside this geofence' })
  async checkGeofence(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckGeofenceDto,
  ) {
    return this.gpsService.checkGeofence(user.organizationId, id, dto.lat, dto.lng);
  }
}
