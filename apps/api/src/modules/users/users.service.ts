import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { User, UserRole } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { AuditLogService } from '../admin/audit-log.service';

export type UserWithDeviceCount = User & { deviceCount: number };

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Organization) private orgsRepo: Repository<Organization>,
    @InjectRepository(AgentDevice) private devicesRepo: Repository<AgentDevice>,
    private tokenService: TokenService,
    private mailerService: MailerService,
    private auditLogService: AuditLogService,
  ) {}

  async findAll(organizationId: string): Promise<UserWithDeviceCount[]> {
    const users = await this.usersRepo.find({
      where: { organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Batch-count active devices per user in a single grouped query.
    // Using the repo's QueryBuilder keeps the identifier-quoting consistent
    // with the rest of the codebase (mixed camelCase / snake_case).
    const rows = await this.devicesRepo
      .createQueryBuilder('d')
      .select('d.user_id', 'userId')
      .addSelect('COUNT(d.id)::int', 'count')
      .where('d.organization_id = :orgId', { orgId: organizationId })
      .andWhere('d.is_active = true')
      .groupBy('d.user_id')
      .getRawMany<{ userId: string; count: number }>();

    const counts = new Map(rows.map((r) => [r.userId, Number(r.count)]));

    return users.map((u) => Object.assign(u, { deviceCount: counts.get(u.id) ?? 0 }));
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

  // ── Personal agent registration token ────────────────────────────────
  //
  // Each user owns a slug-prefixed token on `users.agent_token` of the
  // form `<slug>-<32-hex>`, e.g. `saiprashanth-7f3a2b1c8d4e4f5a9c1e2b...`.
  // The slug is lowercased first+last (fallback: email local-part) with
  // non-alnum stripped and truncated to 24 chars so a copied token is
  // visually identifiable at a glance; the 32-char hex provides the
  // random entropy. Existing bare-UUID tokens from pre-Phase-3 rows keep
  // working — lookups are exact-equality, so the format is irrelevant
  // to the matching logic.
  //
  // After a successful agent registration the token is auto-rotated
  // (see AgentService.registerAgent) so each physical install burns one
  // token. Already-registered devices are unaffected — they use their
  // per-device `agent_devices.device_token` for all subsequent calls.
  //
  // Note on column visibility: `agent_token` is declared `select: false`
  // on the entity, so any read must explicitly list it in `select`. We
  // rely on Repository.update() for writes (no select needed).

  /**
   * Produces `<slug>-<hex32>` where slug is a stable human-readable
   * fragment derived from the user's name (or email) and hex32 is a
   * `randomUUID()` with dashes stripped (32 chars). Max total length 57.
   */
  private buildPersonalToken(
    u: Pick<User, 'firstName' | 'lastName' | 'email'>,
  ): string {
    const nameSource =
      `${u.firstName ?? ''}${u.lastName ?? ''}`.trim() ||
      u.email.split('@')[0];
    const slug =
      nameSource.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) ||
      'user';
    const hex = randomUUID().replace(/-/g, '');
    return `${slug}-${hex}`;
  }

  async getOrGenerateAgentToken(
    userId: string,
  ): Promise<{ token: string; userName: string }> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: ['id', 'firstName', 'lastName', 'email', 'agentToken'],
    });
    if (!user) throw new NotFoundException('User not found');

    let token = user.agentToken;
    if (!token) {
      token = this.buildPersonalToken(user);
      await this.usersRepo.update({ id: userId }, { agentToken: token });
    }

    const userName =
      `${user.firstName} ${user.lastName}`.trim() || user.email;
    return { token, userName };
  }

  async rotateAgentToken(
    userId: string,
  ): Promise<{ token: string; userName: string }> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: ['id', 'firstName', 'lastName', 'email'],
    });
    if (!user) throw new NotFoundException('User not found');

    const token = this.buildPersonalToken(user);
    await this.usersRepo.update({ id: userId }, { agentToken: token });

    const userName =
      `${user.firstName} ${user.lastName}`.trim() || user.email;
    return { token, userName };
  }
}
