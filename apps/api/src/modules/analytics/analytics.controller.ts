import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('productivity')
  @ApiOperation({ summary: 'Daily productivity scores. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD, defaults to today' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD, defaults to from' })
  @ApiQuery({ name: 'userId', required: false })
  getProductivity(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const from_ = from ?? todayISO();
    const to_ = to ?? from_;
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getProductivity(targetUserId, user.organizationId, from_, to_);
  }

  @Get('app-usage')
  @ApiOperation({ summary: 'App usage summary by duration. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'userId', required: false })
  getAppUsage(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const from_ = from ?? todayISO();
    const to_ = to ?? from_;
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getAppUsage(targetUserId, user.organizationId, from_, to_);
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Download time entries as CSV file.' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'userId', required: false })
  async exportCSV(
    @CurrentUser() user: User,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const from_ = from ?? todayISO();
    const to_ = to ?? from_;
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    const csv = await this.service.exportTimeEntriesCSV(
      targetUserId,
      user.organizationId,
      from_,
      to_,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="time-entries-${from_}-${to_}.csv"`,
    );
    res.send(csv);
  }
}
