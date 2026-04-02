import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  // ── Projects ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all projects for the organization' })
  getProjects(@CurrentUser() user: User) {
    return this.service.getProjects(user.organizationId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new project (admin/manager only)' })
  createProject(
    @CurrentUser() user: User,
    @Body() dto: CreateProjectDto,
  ) {
    return this.service.createProject(user.organizationId, user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project with tasks and milestones' })
  getProject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getProjectWithDetails(id, user.organizationId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update project details (admin/manager only)' })
  updateProject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.updateProject(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive project (admin only)' })
  archiveProject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.archiveProject(id, user.organizationId);
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  @Get(':projectId/tasks')
  @ApiOperation({ summary: 'List tasks for a project' })
  getTasks(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getTasks(projectId, user.organizationId);
  }

  @Post(':projectId/tasks')
  @ApiOperation({ summary: 'Create a task in a project' })
  createTask(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.createTask(projectId, user.organizationId, dto);
  }

  @Patch(':projectId/tasks/:id')
  @ApiOperation({ summary: 'Update a task (status, assignee, priority, etc.)' })
  updateTask(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.service.updateTask(projectId, id, user.organizationId, dto);
  }

  @Delete(':projectId/tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  deleteTask(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteTask(projectId, id, user.organizationId);
  }

  // ── Milestones ───────────────────────────────────────────────────────

  @Get(':projectId/milestones')
  @ApiOperation({ summary: 'List milestones for a project' })
  getMilestones(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getMilestones(projectId, user.organizationId);
  }

  @Post(':projectId/milestones')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a milestone (admin/manager only)' })
  createMilestone(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.service.createMilestone(projectId, user.organizationId, dto);
  }

  @Patch(':projectId/milestones/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update milestone or mark complete (admin/manager only)' })
  updateMilestone(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.service.updateMilestone(projectId, id, user.organizationId, dto);
  }

  @Delete(':projectId/milestones/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a milestone (admin/manager only)' })
  deleteMilestone(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteMilestone(projectId, id, user.organizationId);
  }
}
