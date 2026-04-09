import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Organization]), RedisModule, AdminModule],
  controllers: [UsersController],
  providers: [UsersService, TokenService, MailerService],
  exports: [UsersService],
})
export class UsersModule {}
