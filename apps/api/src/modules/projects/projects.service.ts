import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../database/entities/project.entity';
import { Task } from '../../database/entities/task.entity';
import { Milestone } from '../../database/entities/milestone.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectRepo: Repository<Project>,
    @InjectRepository(Task)
    private taskRepo: Repository<Task>,
    @InjectRepository(Milestone)
    private milestoneRepo: Repository<Milestone>,
  ) {}

  // ── Internal helpers ────────────────────────────────────────────────

  private async findProjectInOrg(
    projectId: string,
    organizationId: string,
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw new ForbiddenException('Project not found in this organization');
    }
    return project;
  }

  // ── Projects ────────────────────────────────────────────────────────

  async getProjects(organizationId: string): Promise<Project[]> {
    return this.projectRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createProject(
    organizationId: string,
    userId: string,
    dto: CreateProjectDto,
  ): Promise<Project> {
    const project = this.projectRepo.create({
      organizationId,
      createdBy: userId,
      name: dto.name,
      description: dto.description ?? null,
      status: 'active',
      deadline: dto.deadline ? new Date(dto.deadline) : null,
    });
    return this.projectRepo.save(project);
  }

  async getProjectWithDetails(
    projectId: string,
    organizationId: string,
  ): Promise<{ project: Project; tasks: Task[]; milestones: Milestone[] }> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    const [tasks, milestones] = await Promise.all([
      this.taskRepo.find({
        where: { projectId, organizationId },
        order: { createdAt: 'ASC' },
      }),
      this.milestoneRepo.find({
        where: { projectId, organizationId },
        order: { dueDate: 'ASC' },
      }),
    ]);
    return { project, tasks, milestones };
  }

  async updateProject(
    projectId: string,
    organizationId: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.status !== undefined) project.status = dto.status;
    if (dto.deadline !== undefined) {
      project.deadline = dto.deadline ? new Date(dto.deadline) : null;
    }
    return this.projectRepo.save(project);
  }

  async archiveProject(
    projectId: string,
    organizationId: string,
  ): Promise<void> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    project.status = 'archived';
    await this.projectRepo.save(project);
  }

  // ── Tasks ───────────────────────────────────────────────────────────

  async getTasks(projectId: string, organizationId: string): Promise<Task[]> {
    await this.findProjectInOrg(projectId, organizationId);
    return this.taskRepo.find({
      where: { projectId, organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  async createTask(
    projectId: string,
    organizationId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    await this.findProjectInOrg(projectId, organizationId);
    const task = this.taskRepo.create({
      projectId,
      organizationId,
      assigneeId: dto.assigneeId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      status: 'todo',
      priority: dto.priority ?? 'medium',
      estimatedHours: dto.estimatedHours ?? null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    });
    return this.taskRepo.save(task);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    organizationId: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    await this.findProjectInOrg(projectId, organizationId);
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, organizationId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.assigneeId !== undefined) task.assigneeId = dto.assigneeId;
    if (dto.estimatedHours !== undefined) task.estimatedHours = dto.estimatedHours;
    if (dto.dueDate !== undefined) {
      task.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    return this.taskRepo.save(task);
  }

  async deleteTask(
    projectId: string,
    taskId: string,
    organizationId: string,
  ): Promise<void> {
    await this.findProjectInOrg(projectId, organizationId);
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, organizationId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.taskRepo.delete(taskId);
  }

  // ── Milestones ──────────────────────────────────────────────────────

  async getMilestones(
    projectId: string,
    organizationId: string,
  ): Promise<Milestone[]> {
    await this.findProjectInOrg(projectId, organizationId);
    return this.milestoneRepo.find({
      where: { projectId, organizationId },
      order: { dueDate: 'ASC' },
    });
  }

  async createMilestone(
    projectId: string,
    organizationId: string,
    dto: CreateMilestoneDto,
  ): Promise<Milestone> {
    await this.findProjectInOrg(projectId, organizationId);
    const milestone = this.milestoneRepo.create({
      projectId,
      organizationId,
      name: dto.name,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      completedAt: null,
    });
    return this.milestoneRepo.save(milestone);
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    organizationId: string,
    dto: UpdateMilestoneDto,
  ): Promise<Milestone> {
    await this.findProjectInOrg(projectId, organizationId);
    const milestone = await this.milestoneRepo.findOne({
      where: { id: milestoneId, projectId, organizationId },
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    if (dto.name !== undefined) milestone.name = dto.name;
    if (dto.dueDate !== undefined) {
      milestone.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.markComplete === true && !milestone.completedAt) {
      milestone.completedAt = new Date();
    }
    if (dto.markComplete === false) {
      milestone.completedAt = null;
    }
    return this.milestoneRepo.save(milestone);
  }

  async deleteMilestone(
    projectId: string,
    milestoneId: string,
    organizationId: string,
  ): Promise<void> {
    await this.findProjectInOrg(projectId, organizationId);
    const milestone = await this.milestoneRepo.findOne({
      where: { id: milestoneId, projectId, organizationId },
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    await this.milestoneRepo.delete(milestoneId);
  }
}
