import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { CrashReportDto } from './dto/crash-report.dto';

@ApiTags('Agent Registration')
@Controller('agent')
export class AgentRegistrationController {
  constructor(private readonly service: AgentService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register desktop agent device using an invite token' })
  async register(@Body() dto: RegisterAgentDto) {
    const { agentToken, employeeId, orgId } = await this.service.registerAgent(dto);
    return { agentToken, employeeId, orgId };
  }

  @Post('crash')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Receive crash report from agent (unauthenticated — agent may have lost token)' })
  async receiveCrash(@Body() dto: CrashReportDto) {
    await this.service.saveCrashReport(dto);
    return { received: true };
  }
}
