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
import { Organization } from '../../database/entities/organization.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { AuditLogService } from '../admin/audit-log.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Organization) private orgsRepo: Repository<Organization>,
    private tokenService: TokenService,
    private mailerService: MailerService,
    private auditLogService: AuditLogService,
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

    const savedUser = await this.usersRepo.save(user);

    // Generate invite token and send email
    const token = await this.tokenService.generate('invite', savedUser.id);
    // Get the inviter's name for the email
    const inviter = await this.usersRepo.findOne({ where: { id: invitedBy } });
    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Your admin';
    // Get the organization name
    const organization = await this.orgsRepo.findOne({ where: { id: organizationId } });
    const orgName = organization ? organization.name : 'your organization';
    await this.mailerService.sendInviteEmail(savedUser.email, inviterName, orgName, token);

    // Fire-and-forget audit log — do not block invite response
    void this.auditLogService.log(
      organizationId,
      { id: invitedBy, email: inviter?.email ?? 'unknown' },
      'user.invited',
      'user',
      savedUser.id,
      { invitedEmail: dto.email, role: dto.role },
    );

    return savedUser;
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
