import {
  Injectable, CanActivate, ExecutionContext, UnauthorizedException,
  Inject, forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { AgentService } from './agent.service';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => AgentService))
    private agentService: AgentService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader: string | undefined = request.headers['authorization'];
    const xDeviceToken: string | undefined = request.headers['x-device-token'];
    const raw = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : xDeviceToken;

    if (!raw) throw new UnauthorizedException('No device token provided');

    const device = await this.agentService.findDeviceByToken(raw);
    if (!device) throw new UnauthorizedException('Invalid or expired device token');

    const user = await this.userRepo.findOne({ where: { id: device.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');

    request.agentUser = user;
    return true;
  }
}
