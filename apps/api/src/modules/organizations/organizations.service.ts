import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../database/entities/organization.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private orgsRepo: Repository<Organization>,
  ) {}

  async findById(id: string): Promise<Organization> {
    const org = await this.orgsRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    await this.orgsRepo.update(id, { ...dto });
    return this.findById(id);
  }
}
