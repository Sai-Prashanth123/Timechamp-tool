import {
  Controller,
  Get,
  Inject,
  Optional,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AgentService } from './agent.service';

@ApiTags('Agent Management')
@UseGuards(JwtAuthGuard)
@Controller('agent')
export class AgentManagementController {
  constructor(
    private readonly agentService: AgentService,
    @Optional() @Inject('TOKEN_SERVICE') private readonly tokenService: any,
  ) {}

  @Post('invite-token')
  @ApiOperation({ summary: 'Generate a 72-hour invite token for agent registration' })
  async generateInviteToken(@Request() req: any) {
    if (!this.tokenService) {
      return { token: null, message: 'Token service not configured' };
    }
    const token = await this.tokenService.generate('invite', req.user.sub);
    return { token };
  }

  @Get('devices')
  @ApiOperation({ summary: 'List all registered agent devices for the authenticated org' })
  async listDevices(@Request() req: any) {
    const orgId: string = req.user.orgId ?? req.user.organizationId;
    return this.agentService.getDevicesForOrg(orgId);
  }
}
