import {
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AgentService } from './agent.service';
import { TokenService } from '../../infrastructure/token/token.service';

@ApiTags('Agent Management')
@UseGuards(JwtAuthGuard)
@Controller('agent')
export class AgentManagementController {
  constructor(
    private readonly agentService: AgentService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('invite-token')
  @ApiOperation({ summary: 'Generate a 72-hour invite token for agent registration' })
  async generateInviteToken(@Request() req: any) {
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
