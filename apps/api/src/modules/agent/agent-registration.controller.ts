import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { RegisterAgentDto } from './dto/register-agent.dto';

@ApiTags('Agent Registration')
@Controller('agent')
export class AgentRegistrationController {
  constructor(private readonly service: AgentService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register desktop agent device using an invite token' })
  async register(@Body() dto: RegisterAgentDto) {
    const { agentToken, employeeId, orgId } = await this.service.registerAgent(dto);
    return { data: { agentToken, employeeId, orgId } };
  }
}
