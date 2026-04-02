import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing agent token');
    }
    const token = auth.slice(7);

    // agent_token has select: false so we must explicitly select it
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.agentToken')
      .where('user.agentToken = :token AND user.isActive = true', { token })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid agent token');
    }

    req.agentUser = user;
    return true;
  }
}
