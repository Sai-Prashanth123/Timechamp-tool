import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { MonitoringService } from './monitoring.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Monitoring')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}

  @Get('live')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all currently clocked-in employees with their current app' })
  getLiveStatus(@CurrentUser() user: User) {
    return this.service.getLiveStatus(user.organizationId);
  }

  @Get('activity')
  @ApiOperation({ summary: 'List activity events. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getActivity(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Employees can only see their own activity
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getActivity(targetUserId, user.organizationId, { from, to });
  }

  @Get('screenshots')
  @ApiOperation({ summary: 'List screenshots. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getScreenshots(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getScreenshots(targetUserId, user.organizationId, { from, to });
  }
}
