import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { User } from '../../database/entities/user.entity';
import { Project } from '../../database/entities/project.entity';
import { Task } from '../../database/entities/task.entity';
import { Timesheet } from '../../database/entities/timesheet.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { AuditLogService } from './audit-log.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, User, Project, Task, Timesheet, Subscription]),
  ],
  controllers: [AdminController],
  providers: [AuditLogService, AdminService],
  exports: [AuditLogService],
})
export class AdminModule {}
