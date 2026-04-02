import { PartialType } from '@nestjs/swagger';
import { CreateGeofenceDto } from './create-geofence.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGeofenceDto extends PartialType(CreateGeofenceDto) {
  @ApiPropertyOptional({ description: 'Activate or deactivate the geofence' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
