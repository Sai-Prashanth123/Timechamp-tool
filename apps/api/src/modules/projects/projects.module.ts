import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { Project } from '../../database/entities/project.entity';
import { Task } from '../../database/entities/task.entity';
import { Milestone } from '../../database/entities/milestone.entity';
import { TaskComment } from '../../database/entities/task-comment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Project, Task, Milestone, TaskComment])],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
