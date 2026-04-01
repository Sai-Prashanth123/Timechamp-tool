import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../../database/entities/user.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {}

  async findAll(organizationId: string): Promise<User[]> {
    return this.usersRepo.find({
      where: { organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, organizationId: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async invite(
    organizationId: string,
    invitedBy: string,
    dto: InviteUserDto,
  ): Promise<User> {
    const existing = await this.usersRepo.findOne({
      where: { email: dto.email.toLowerCase(), organizationId },
    });
    if (existing) {
      throw new ConflictException(
        'A user with this email already exists in the organization',
      );
    }

    // Temporary random password — user will reset via invite email
    const tempPassword = randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = this.usersRepo.create({
      organizationId,
      email: dto.email.toLowerCase(),
      passwordHash,
      firstName: '',
      lastName: '',
      role: dto.role,
      invitedBy,
      emailVerified: false,
    });

    return this.usersRepo.save(user);
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateUserDto,
  ): Promise<User> {
    const user = await this.findById(id, organizationId);
    Object.assign(user, dto);
    return this.usersRepo.save(user);
  }

  async deactivate(
    id: string,
    organizationId: string,
    requestingUserId: string,
  ): Promise<void> {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.findById(id, organizationId);
    await this.usersRepo.update(user.id, { isActive: false });
  }
}
