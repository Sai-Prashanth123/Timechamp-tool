import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current organization' })
  getMyOrg(@CurrentUser() user: User) {
    return this.orgsService.findById(user.organizationId);
  }

  @Patch('me')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update current organization (admin only)' })
  updateMyOrg(
    @CurrentUser() user: User,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.orgsService.update(user.organizationId, dto);
  }
}
