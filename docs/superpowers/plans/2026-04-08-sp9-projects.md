# SP9: Projects & Kanban Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing project/task foundation with a full-featured Kanban board using drag-and-drop (`@dnd-kit`), task comments, color-coded projects, position-based task ordering, a `TaskDetailDrawer`, and a list-view tab — all consistent with the existing NestJS + Next.js 14 architecture.

**Architecture:** The existing `projects` module already has CRUD for projects, tasks, and milestones. SP9 adds: (1) a migration that extends `projects` with a `color` column, extends `tasks` with `position` and `created_by`, and creates `task_comments`; (2) updated entities and DTOs to expose the new columns; (3) new service methods (`moveTask`, `addComment`, `getComments`); (4) new controller routes for move and comments; (5) new frontend hooks (`useMoveTask`, `useAddComment`, `useComments`); (6) a drag-and-drop `KanbanBoard` built on `@dnd-kit/core` + `@dnd-kit/sortable`; (7) a `TaskCard` component with priority badge, assignee avatar, and due-date highlight; (8) a `TaskDetailDrawer` (Sheet) with inline editing and comment thread; and (9) an updated project detail page with Board/List tabs.

**Tech Stack:** NestJS + TypeORM (backend), Next.js 14 App Router, TanStack React Query 5, `@dnd-kit/core` + `@dnd-kit/sortable`, Tailwind CSS, shadcn/ui (frontend).

---

## What Is Already Complete — Do Not Rewrite

| File | Status |
|------|--------|
| `apps/api/src/database/migrations/005_projects_schema.ts` | Complete — creates `projects`, `tasks`, `milestones` tables |
| `apps/api/src/database/entities/project.entity.ts` | Complete — basic fields; needs `color` added |
| `apps/api/src/database/entities/task.entity.ts` | Complete — basic fields; needs `position`, `createdBy` added |
| `apps/api/src/database/entities/milestone.entity.ts` | Complete |
| `apps/api/src/modules/projects/projects.service.ts` | Complete for CRUD; needs `moveTask`, `addComment`, `getComments` |
| `apps/api/src/modules/projects/projects.service.spec.ts` | Complete for CRUD; needs tests for new methods |
| `apps/api/src/modules/projects/projects.controller.ts` | Complete for CRUD; needs move + comment routes |
| `apps/api/src/modules/projects/projects.module.ts` | Complete — needs `TaskComment` entity added |
| `apps/api/src/modules/projects/dto/create-project.dto.ts` | Complete — needs `color` field |
| `apps/api/src/modules/projects/dto/update-project.dto.ts` | Complete — needs `color` field |
| `apps/api/src/modules/projects/dto/create-task.dto.ts` | Complete |
| `apps/api/src/modules/projects/dto/update-task.dto.ts` | Complete |
| `apps/web/hooks/use-projects.ts` | Complete for CRUD; needs `useMoveTask`, `useAddComment`, `useComments` |
| `apps/web/components/projects/project-list.tsx` | Complete — needs color swatch in ProjectCard |
| `apps/web/components/projects/kanban-board.tsx` | Basic (chevron arrows) — replace with full dnd-kit version |
| `apps/web/app/(dashboard)/projects/page.tsx` | Complete |
| `apps/web/app/(dashboard)/projects/[id]/page.tsx` | Has Board card — needs Board/List tabs |

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/api/src/database/migrations/014_projects_kanban.ts` | Add `color` to projects, `position`+`created_by` to tasks, create `task_comments` |
| Modify | `apps/api/src/database/entities/project.entity.ts` | Add `color` column |
| Modify | `apps/api/src/database/entities/task.entity.ts` | Add `position`, `createdBy` columns |
| Create | `apps/api/src/database/entities/task-comment.entity.ts` | New entity for `task_comments` table |
| Modify | `apps/api/src/modules/projects/dto/create-project.dto.ts` | Add optional `color` field |
| Modify | `apps/api/src/modules/projects/dto/update-project.dto.ts` | Add optional `color` field |
| Create | `apps/api/src/modules/projects/dto/move-task.dto.ts` | `{ status, position }` DTO |
| Create | `apps/api/src/modules/projects/dto/create-comment.dto.ts` | `{ content }` DTO |
| Modify | `apps/api/src/modules/projects/projects.service.ts` | Add `moveTask`, `addComment`, `getComments`; update `createProject`/`createTask` |
| Modify | `apps/api/src/modules/projects/projects.service.spec.ts` | Add tests for `moveTask`, `addComment`, `getComments` |
| Modify | `apps/api/src/modules/projects/projects.controller.ts` | Add `PATCH tasks/:id/move`, `GET tasks/:id/comments`, `POST tasks/:id/comments` |
| Modify | `apps/api/src/modules/projects/projects.module.ts` | Register `TaskComment` entity |
| Modify | `apps/web/hooks/use-projects.ts` | Add `useMoveTask`, `useAddComment`, `useComments`; extend types with `color`, `position` |
| Modify | `apps/web/components/projects/project-list.tsx` | Add color swatch to ProjectCard |
| Modify | `apps/web/components/projects/kanban-board.tsx` | Full rewrite with `@dnd-kit` drag-and-drop |
| Create | `apps/web/components/projects/task-card.tsx` | Priority badge, assignee avatar, due-date, click handler |
| Create | `apps/web/components/projects/task-detail-drawer.tsx` | Sheet with inline edit, assignee, priority, due-date, comments |
| Modify | `apps/web/app/(dashboard)/projects/[id]/page.tsx` | Add Board/List tab switcher |

---

## Task SP9-T1: Migration + Entities + DTOs

**Files:**
- Create: `apps/api/src/database/migrations/014_projects_kanban.ts`
- Modify: `apps/api/src/database/entities/project.entity.ts`
- Modify: `apps/api/src/database/entities/task.entity.ts`
- Create: `apps/api/src/database/entities/task-comment.entity.ts`
- Modify: `apps/api/src/modules/projects/dto/create-project.dto.ts`
- Modify: `apps/api/src/modules/projects/dto/update-project.dto.ts`
- Create: `apps/api/src/modules/projects/dto/move-task.dto.ts`
- Create: `apps/api/src/modules/projects/dto/create-comment.dto.ts`

- [ ] **Step 1: Create the migration**

```typescript
// apps/api/src/database/migrations/014_projects_kanban.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectsKanban1744070400014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── projects: add color column ──────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#3B82F6';
    `);

    // ── tasks: add position + created_by columns ────────────────────────
    await queryRunner.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS position    INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(project_id, status, position);
    `);

    // ── task_comments ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_user ON task_comments(user_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS task_comments CASCADE;`);
    await queryRunner.query(`
      ALTER TABLE tasks
        DROP COLUMN IF EXISTS created_by,
        DROP COLUMN IF EXISTS position;
    `);
    await queryRunner.query(`
      ALTER TABLE projects
        DROP COLUMN IF EXISTS color;
    `);
  }
}
```

- [ ] **Step 2: Update Project entity**

Open `apps/api/src/database/entities/project.entity.ts`. Add the `color` column after the `status` column:

```typescript
// apps/api/src/database/entities/project.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 50, default: 'active' })
  status: string;

  @Column({ length: 7, default: '#3B82F6' })
  color: string;

  @Column({ name: 'deadline', type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @Column({ name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Update Task entity**

Open `apps/api/src/database/entities/task.entity.ts`. Add `position` and `createdBy` columns:

```typescript
// apps/api/src/database/entities/task.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from './project.entity';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id' })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'assignee_id', nullable: true })
  assigneeId: string | null;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 50, default: 'todo' })
  status: string;

  @Column({ length: 50, default: 'medium' })
  priority: string;

  @Column({
    name: 'estimated_hours',
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  estimatedHours: number | null;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'position', default: 0 })
  position: number;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 4: Create TaskComment entity**

```typescript
// apps/api/src/database/entities/task-comment.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Task } from './task.entity';
import { User } from './user.entity';

@Entity('task_comments')
export class TaskComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id' })
  taskId: string;

  @ManyToOne(() => Task)
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 5: Update CreateProjectDto — add color**

Open `apps/api/src/modules/projects/dto/create-project.dto.ts` and add the `color` field:

```typescript
// apps/api/src/modules/projects/dto/create-project.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsISO8601,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: 'Website Redesign' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: 'Complete overhaul of the marketing site' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @ApiPropertyOptional({ example: '#3B82F6', description: 'Hex color code' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a valid hex color' })
  color?: string;
}
```

- [ ] **Step 6: Update UpdateProjectDto — add color**

Open `apps/api/src/modules/projects/dto/update-project.dto.ts` and add the `color` field:

```typescript
// apps/api/src/modules/projects/dto/update-project.dto.ts
import {
  IsString,
  IsOptional,
  IsISO8601,
  IsIn,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Website Redesign v2' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['active', 'completed', 'on_hold', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'completed', 'on_hold', 'archived'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deadline?: string | null;

  @ApiPropertyOptional({ example: '#10B981', description: 'Hex color code' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a valid hex color' })
  color?: string;
}
```

- [ ] **Step 7: Create MoveTaskDto**

```typescript
// apps/api/src/modules/projects/dto/move-task.dto.ts
import { IsString, IsIn, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveTaskDto {
  @ApiProperty({ enum: ['todo', 'in_progress', 'in_review', 'done'] })
  @IsString()
  @IsIn(['todo', 'in_progress', 'in_review', 'done'])
  status: string;

  @ApiProperty({ example: 2, description: 'Zero-based position within the column' })
  @IsInt()
  @Min(0)
  position: number;
}
```

- [ ] **Step 8: Create CreateCommentDto**

```typescript
// apps/api/src/modules/projects/dto/create-comment.dto.ts
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'Looks good — please add mobile responsive styles.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
```

---

## Task SP9-T2: ProjectsService — moveTask + comments (TDD)

**Files:**
- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/projects/projects.service.spec.ts`

- [ ] **Step 1: Write failing tests — append to existing spec file**

Open `apps/api/src/modules/projects/projects.service.spec.ts`. Add the following `describe` blocks at the bottom of the file (before the closing `}`), updating the imports and mock setup at the top to include `TaskComment`:

First, update the import block at the top of the spec file to add the new entity and token:

```typescript
// Add to imports at top of projects.service.spec.ts:
import { TaskComment } from '../../database/entities/task-comment.entity';
```

Then update the `mockRepo` factory call and `providers` array in the `beforeEach` to add a `commentRepo`:

```typescript
// Inside the describe('ProjectsService') beforeEach:
// Add:
let commentRepo: MockRepo<TaskComment>;

// In the beforeEach body:
commentRepo = mockRepo<TaskComment>();

// In the providers array:
{ provide: getRepositoryToken(TaskComment), useValue: commentRepo },
```

Now append the new `describe` blocks at the end of the outer `describe('ProjectsService')`:

```typescript
  // ── moveTask ───────────────────────────────────────────────────────
  describe('moveTask', () => {
    it('updates task status and position', async () => {
      const existing: Partial<Task> = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'todo',
        position: 0,
      };
      const updated = { ...existing, status: 'in_progress', position: 1 };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(existing);
      taskRepo.save.mockResolvedValue(updated);

      const result = await service.moveTask(PROJECT_ID, TASK_ID, ORG_ID, {
        status: 'in_progress',
        position: 1,
      });

      expect(taskRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_progress', position: 1 }),
      );
      expect(result.status).toBe('in_progress');
      expect(result.position).toBe(1);
    });

    it('throws ForbiddenException when project belongs to different org', async () => {
      projectRepo.findOne.mockResolvedValue(null);

      await expect(
        service.moveTask(PROJECT_ID, TASK_ID, 'wrong-org', { status: 'done', position: 0 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when task does not exist', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.moveTask(PROJECT_ID, 'bad-task', ORG_ID, { status: 'done', position: 0 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── addComment ─────────────────────────────────────────────────────
  describe('addComment', () => {
    it('creates and returns a comment', async () => {
      const COMMENT_ID = 'cmt-1';
      const USER_ID = 'user-1';
      const created: Partial<TaskComment> = {
        id: COMMENT_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        content: 'Looks good!',
      };
      taskRepo.findOne.mockResolvedValue({ id: TASK_ID, organizationId: ORG_ID });
      commentRepo.create.mockReturnValue(created);
      commentRepo.save.mockResolvedValue(created);

      const result = await service.addComment(TASK_ID, ORG_ID, USER_ID, 'Looks good!');

      expect(commentRepo.create).toHaveBeenCalledWith({
        taskId: TASK_ID,
        userId: USER_ID,
        content: 'Looks good!',
      });
      expect(result.id).toBe(COMMENT_ID);
    });

    it('throws NotFoundException when task does not exist in org', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addComment('bad-task', ORG_ID, 'user-1', 'Hello'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getComments ────────────────────────────────────────────────────
  describe('getComments', () => {
    it('returns comments for a task ordered by createdAt ASC', async () => {
      const comments: Partial<TaskComment>[] = [
        { id: 'cmt-1', taskId: TASK_ID, userId: 'user-1', content: 'First' },
        { id: 'cmt-2', taskId: TASK_ID, userId: 'user-2', content: 'Second' },
      ];
      taskRepo.findOne.mockResolvedValue({ id: TASK_ID, organizationId: ORG_ID });
      commentRepo.find.mockResolvedValue(comments);

      const result = await service.getComments(TASK_ID, ORG_ID);

      expect(commentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: TASK_ID } }),
      );
      expect(result).toHaveLength(2);
    });

    it('throws NotFoundException when task does not exist in org', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await expect(service.getComments('bad-task', ORG_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest projects.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `moveTask is not a function`, `addComment is not a function`, `getComments is not a function`, and `commentRepo` provider not registered.

- [ ] **Step 3: Update ProjectsService — add three methods and update createProject/createTask**

Open `apps/api/src/modules/projects/projects.service.ts`. Add the `TaskComment` import and inject it. Replace the existing file content with:

```typescript
// apps/api/src/modules/projects/projects.service.ts
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
import { TaskComment } from '../../database/entities/task-comment.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
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
    @InjectRepository(TaskComment)
    private commentRepo: Repository<TaskComment>,
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

  private async findTaskInOrg(
    taskId: string,
    organizationId: string,
  ): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
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
      color: dto.color ?? '#3B82F6',
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
        order: { status: 'ASC', position: 'ASC', createdAt: 'ASC' },
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
    if (dto.color !== undefined) project.color = dto.color;
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
      order: { status: 'ASC', position: 'ASC', createdAt: 'ASC' },
    });
  }

  async createTask(
    projectId: string,
    organizationId: string,
    userId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    await this.findProjectInOrg(projectId, organizationId);
    // Auto-assign position = count of tasks in the same status column
    const count = await this.taskRepo.count({
      where: { projectId, organizationId, status: 'todo' },
    });
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
      position: count,
      createdBy: userId,
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

  async moveTask(
    projectId: string,
    taskId: string,
    organizationId: string,
    dto: MoveTaskDto,
  ): Promise<Task> {
    await this.findProjectInOrg(projectId, organizationId);
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, organizationId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    task.status = dto.status;
    task.position = dto.position;
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

  // ── Comments ────────────────────────────────────────────────────────

  async getComments(taskId: string, organizationId: string): Promise<TaskComment[]> {
    await this.findTaskInOrg(taskId, organizationId);
    return this.commentRepo.find({
      where: { taskId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  async addComment(
    taskId: string,
    organizationId: string,
    userId: string,
    content: string,
  ): Promise<TaskComment> {
    await this.findTaskInOrg(taskId, organizationId);
    const comment = this.commentRepo.create({ taskId, userId, content });
    return this.commentRepo.save(comment);
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
```

**Note:** `createTask` now accepts `userId` as a third argument. The controller call must be updated in the next task.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest projects.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: All tests PASS. Fix any remaining mock mismatches before proceeding.

---

## Task SP9-T3: ProjectsController + ProjectsModule

**Files:**
- Modify: `apps/api/src/modules/projects/projects.controller.ts`
- Modify: `apps/api/src/modules/projects/projects.module.ts`

- [ ] **Step 1: Update ProjectsModule to register TaskComment**

Replace `apps/api/src/modules/projects/projects.module.ts`:

```typescript
// apps/api/src/modules/projects/projects.module.ts
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
```

- [ ] **Step 2: Update ProjectsController — add move + comment routes, fix createTask userId**

Replace `apps/api/src/modules/projects/projects.controller.ts`:

```typescript
// apps/api/src/modules/projects/projects.controller.ts
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
import { MoveTaskDto } from './dto/move-task.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
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
    return this.service.createTask(projectId, user.organizationId, user.id, dto);
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

  @Patch(':projectId/tasks/:id/move')
  @ApiOperation({ summary: 'Move task to a new column and position (drag-and-drop)' })
  moveTask(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTaskDto,
  ) {
    return this.service.moveTask(projectId, id, user.organizationId, dto);
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

  // ── Comments ─────────────────────────────────────────────────────────

  @Get(':projectId/tasks/:id/comments')
  @ApiOperation({ summary: 'Get comments for a task' })
  getComments(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getComments(id, user.organizationId);
  }

  @Post(':projectId/tasks/:id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  addComment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.service.addComment(id, user.organizationId, user.id, dto.content);
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
```

- [ ] **Step 3: Verify API compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. Fix any type errors before proceeding.

- [ ] **Step 4: Run full test suite**

```bash
cd apps/api && npx jest --no-coverage 2>&1 | tail -15
```

Expected: All tests PASS.

---

## Task SP9-T4: Frontend Hooks

**Files:**
- Modify: `apps/web/hooks/use-projects.ts`

- [ ] **Step 1: Install @dnd-kit packages**

Check `apps/web/package.json` — `@dnd-kit/core` and `@dnd-kit/sortable` are NOT present. Install them:

```bash
cd apps/web && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Verify the packages appear in `apps/web/package.json` under `dependencies`.

- [ ] **Step 2: Update use-projects.ts — extend types and add new hooks**

Replace `apps/web/hooks/use-projects.ts` with the full updated file:

```typescript
// apps/web/hooks/use-projects.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  deadline: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  projectId: string;
  organizationId: string;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedHours: number | null;
  dueDate: string | null;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskComment = {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
  };
};

export type Milestone = {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetails = {
  project: Project;
  tasks: Task[];
  milestones: Milestone[];
};

export type CreateProjectPayload = {
  name: string;
  description?: string;
  deadline?: string;
  color?: string;
};

export type UpdateProjectPayload = {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  deadline?: string | null;
  color?: string;
};

export type CreateTaskPayload = {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  estimatedHours?: number;
  dueDate?: string;
};

export type UpdateTaskPayload = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  estimatedHours?: number | null;
  dueDate?: string | null;
};

export type MoveTaskPayload = {
  status: TaskStatus;
  position: number;
};

export type CreateMilestonePayload = {
  name: string;
  dueDate?: string;
};

export type UpdateMilestonePayload = {
  name?: string;
  dueDate?: string | null;
  markComplete?: boolean;
};

// ── Projects ───────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await api.get('/projects');
      return data.data as Project[];
    },
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: async () => {
      const { data } = await api.get(`/projects/${id}`);
      return data.data as ProjectDetails;
    },
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateProjectPayload) => {
      const { data } = await api.post('/projects', payload);
      return data.data as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to create project';
      toast.error(message);
    },
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateProjectPayload) => {
      const { data } = await api.patch(`/projects/${id}`, payload);
      return data.data as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', id] });
      toast.success('Project updated');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to update project';
      toast.error(message);
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project archived');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to archive project';
      toast.error(message);
    },
  });
}

// ── Tasks ──────────────────────────────────────────────────────────────

export function useTasks(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'tasks'],
    queryFn: async () => {
      const { data } = await api.get(`/projects/${projectId}/tasks`);
      return data.data as Task[];
    },
    enabled: !!projectId,
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateTaskPayload) => {
      const { data } = await api.post(`/projects/${projectId}/tasks`, payload);
      return data.data as Task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] });
      toast.success('Task created');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to create task';
      toast.error(message);
    },
  });
}

export function useUpdateTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateTaskPayload & { id: string }) => {
      const { data } = await api.patch(
        `/projects/${projectId}/tasks/${id}`,
        payload,
      );
      return data.data as Task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to update task';
      toast.error(message);
    },
  });
}

export function useMoveTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: MoveTaskPayload & { id: string }) => {
      const { data } = await api.patch(
        `/projects/${projectId}/tasks/${id}/move`,
        payload,
      );
      return data.data as Task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to move task';
      toast.error(message);
    },
  });
}

export function useDeleteTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await api.delete(`/projects/${projectId}/tasks/${taskId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] });
      toast.success('Task deleted');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to delete task';
      toast.error(message);
    },
  });
}

// ── Comments ───────────────────────────────────────────────────────────

export function useComments(projectId: string, taskId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', taskId, 'comments'],
    queryFn: async () => {
      const { data } = await api.get(
        `/projects/${projectId}/tasks/${taskId}/comments`,
      );
      return data.data as TaskComment[];
    },
    enabled: !!taskId,
  });
}

export function useAddComment(projectId: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { data } = await api.post(
        `/projects/${projectId}/tasks/${taskId}/comments`,
        { content },
      );
      return data.data as TaskComment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'tasks', taskId, 'comments'],
      });
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to add comment';
      toast.error(message);
    },
  });
}

// ── Milestones ─────────────────────────────────────────────────────────

export function useMilestones(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'milestones'],
    queryFn: async () => {
      const { data } = await api.get(`/projects/${projectId}/milestones`);
      return data.data as Milestone[];
    },
    enabled: !!projectId,
  });
}

export function useCreateMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateMilestonePayload) => {
      const { data } = await api.post(
        `/projects/${projectId}/milestones`,
        payload,
      );
      return data.data as Milestone;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'milestones'],
      });
      toast.success('Milestone created');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to create milestone';
      toast.error(message);
    },
  });
}

export function useUpdateMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: UpdateMilestonePayload & { id: string }) => {
      const { data } = await api.patch(
        `/projects/${projectId}/milestones/${id}`,
        payload,
      );
      return data.data as Milestone;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'milestones'],
      });
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to update milestone';
      toast.error(message);
    },
  });
}

export function useDeleteMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (milestoneId: string) => {
      await api.delete(`/projects/${projectId}/milestones/${milestoneId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'milestones'],
      });
      toast.success('Milestone deleted');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to delete milestone';
      toast.error(message);
    },
  });
}
```

---

## Task SP9-T5: Kanban UI Components

**Files:**
- Create: `apps/web/components/projects/task-card.tsx`
- Create: `apps/web/components/projects/task-detail-drawer.tsx`
- Modify: `apps/web/components/projects/kanban-board.tsx`
- Modify: `apps/web/components/projects/project-list.tsx`

- [ ] **Step 1: Create TaskCard component**

```typescript
// apps/web/components/projects/task-card.tsx
'use client';

import { forwardRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { type Task, type TaskPriority } from '@/hooks/use-projects';
import { CalendarDays, AlertCircle } from 'lucide-react';

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  high: 'bg-amber-100 text-amber-700 border-amber-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
};

function getInitials(id: string): string {
  // Display first 2 chars of the UUID segment as placeholder
  return id.slice(0, 2).toUpperCase();
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate) < new Date(new Date().toDateString());
}

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  isDragging?: boolean;
  style?: React.CSSProperties;
}

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(
  ({ task, onClick, isDragging, style }, ref) => {
    const overdue = task.dueDate ? isOverdue(task.dueDate) : false;

    return (
      <div
        ref={ref}
        style={style}
        className={`touch-none ${isDragging ? 'opacity-50' : ''}`}
      >
        <Card
          className="cursor-pointer shadow-sm hover:shadow-md transition-shadow border border-border"
          onClick={onClick}
        >
          <CardContent className="p-3 space-y-2">
            {/* Title + Priority */}
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">
                {task.title}
              </p>
              <span
                className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded border capitalize ${
                  PRIORITY_COLORS[task.priority]
                }`}
              >
                {task.priority}
              </span>
            </div>

            {/* Description preview */}
            {task.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {task.description}
              </p>
            )}

            {/* Footer: assignee avatar + due date */}
            <div className="flex items-center justify-between pt-0.5">
              {task.assigneeId ? (
                <div
                  className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold"
                  title={`Assignee: ${task.assigneeId}`}
                >
                  {getInitials(task.assigneeId)}
                </div>
              ) : (
                <div className="h-6 w-6" />
              )}

              {task.dueDate && (
                <span
                  className={`flex items-center gap-1 text-xs ${
                    overdue
                      ? 'text-red-600 font-semibold'
                      : 'text-muted-foreground'
                  }`}
                >
                  {overdue ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <CalendarDays className="h-3 w-3" />
                  )}
                  {new Date(task.dueDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  },
);

TaskCard.displayName = 'TaskCard';
```

- [ ] **Step 2: Create TaskDetailDrawer**

```typescript
// apps/web/components/projects/task-detail-drawer.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useUpdateTask,
  useComments,
  useAddComment,
  useDeleteTask,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '@/hooks/use-projects';
import { Trash2, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
};

interface TaskDetailDrawerProps {
  task: Task | null;
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function TaskDetailDrawer({
  task,
  projectId,
  open,
  onClose,
}: TaskDetailDrawerProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const updateTask = useUpdateTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const { data: comments, isLoading: loadingComments } = useComments(
    projectId,
    task?.id ?? '',
  );
  const addComment = useAddComment(projectId, task?.id ?? '');

  // Sync local state when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setStatus(task.status);
      setPriority(task.priority);
      setAssigneeId(task.assigneeId ?? '');
      setDueDate(
        task.dueDate
          ? new Date(task.dueDate).toISOString().split('T')[0]
          : '',
      );
      setIsDirty(false);
    }
  }, [task]);

  if (!task) return null;

  const handleSave = () => {
    updateTask.mutate(
      {
        id: task.id,
        title: title.trim() || task.title,
        description: description.trim() || null,
        status,
        priority,
        assigneeId: assigneeId.trim() || null,
        dueDate: dueDate || null,
      },
      {
        onSuccess: () => {
          setIsDirty(false);
          toast.success('Task updated');
        },
      },
    );
  };

  const handleDelete = () => {
    deleteTask.mutate(task.id, {
      onSuccess: onClose,
    });
  };

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment.mutate(commentText.trim(), {
      onSuccess: () => setCommentText(''),
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0 overflow-hidden"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="text-base">Task Details</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Title */}
          <div className="space-y-1">
            <Label htmlFor="drawer-title">Title</Label>
            <Input
              id="drawer-title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }}
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="drawer-desc">Description</Label>
            <Textarea
              id="drawer-desc"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }}
              rows={3}
              placeholder="Add a description..."
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="drawer-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => { setStatus(v as TaskStatus); setIsDirty(true); }}
              >
                <SelectTrigger id="drawer-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="drawer-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => { setPriority(v as TaskPriority); setIsDirty(true); }}
              >
                <SelectTrigger id="drawer-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          PRIORITY_COLORS[opt.value]
                        }`}
                      >
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignee */}
          <div className="space-y-1">
            <Label htmlFor="drawer-assignee">Assignee User ID</Label>
            <Input
              id="drawer-assignee"
              value={assigneeId}
              onChange={(e) => { setAssigneeId(e.target.value); setIsDirty(true); }}
              placeholder="UUID of assignee (or leave blank)"
            />
          </div>

          {/* Due Date */}
          <div className="space-y-1">
            <Label htmlFor="drawer-due">Due Date</Label>
            <Input
              id="drawer-due"
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value); setIsDirty(true); }}
            />
          </div>

          {/* Save / Delete row */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteTask.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || updateTask.isPending}
            >
              {updateTask.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save changes
            </Button>
          </div>

          {/* Comments */}
          <div className="border-t pt-4 space-y-3">
            <h3 className="text-sm font-semibold">Comments</h3>

            {loadingComments ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : comments?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <ul className="space-y-3">
                {comments?.map((comment) => (
                  <li key={comment.id} className="flex gap-2">
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                      {comment.user
                        ? `${comment.user.firstName[0]}${comment.user.lastName[0]}`
                        : comment.userId.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium">
                          {comment.user
                            ? `${comment.user.firstName} ${comment.user.lastName}`
                            : 'User'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(comment.createdAt).toLocaleDateString(
                            'en-US',
                            { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
                          )}
                        </span>
                      </div>
                      <p className="text-sm mt-0.5 break-words">{comment.content}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Add comment form */}
            <form onSubmit={handleAddComment} className="flex gap-2 pt-1">
              <Input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!commentText.trim() || addComment.isPending}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Note:** `Sheet` component is from shadcn/ui. If it is not yet installed, run:
```bash
cd apps/web && npx shadcn-ui@latest add sheet
```

- [ ] **Step 3: Rewrite KanbanBoard with @dnd-kit drag-and-drop**

Replace `apps/web/components/projects/kanban-board.tsx`:

```typescript
// apps/web/components/projects/kanban-board.tsx
'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskCard } from './task-card';
import { TaskDetailDrawer } from './task-detail-drawer';
import {
  useMoveTask,
  useCreateTask,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '@/hooks/use-projects';
import { Plus } from 'lucide-react';

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'todo', label: 'To Do', color: 'bg-slate-100' },
  { key: 'in_progress', label: 'In Progress', color: 'bg-blue-50' },
  { key: 'in_review', label: 'In Review', color: 'bg-amber-50' },
  { key: 'done', label: 'Done', color: 'bg-green-50' },
];

// ── Sortable task wrapper ────────────────────────────────────────────

function SortableTaskCard({
  task,
  onSelect,
}: {
  task: Task;
  onSelect: (task: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task, columnId: task.status } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      onClick={() => onSelect(task)}
      isDragging={isDragging}
      style={style}
      {...attributes}
      {...listeners}
    />
  );
}

// ── Create task dialog ───────────────────────────────────────────────

function CreateTaskDialog({
  projectId,
  defaultStatus = 'todo',
}: {
  projectId: string;
  defaultStatus?: TaskStatus;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const createTask = useCreateTask(projectId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle('');
          setDescription('');
          setPriority('medium');
          setDueDate('');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="new-task-title">Title</Label>
            <Input
              id="new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Design homepage mockup"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-task-desc">Description</Label>
            <Input
              id="new-task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-task-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
              >
                <SelectTrigger id="new-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-task-due">Due Date</Label>
              <Input
                id="new-task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createTask.isPending}>
              {createTask.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── KanbanBoard ──────────────────────────────────────────────────────

interface KanbanBoardProps {
  tasks: Task[];
  projectId: string;
}

export function KanbanBoard({ tasks: initialTasks, projectId }: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const moveTask = useMoveTask(projectId);

  // Keep local state in sync when parent tasks change (React Query refetch)
  useState(() => {
    setTasks(initialTasks);
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const grouped = COLUMNS.reduce<Record<TaskStatus, Task[]>>(
    (acc, col) => {
      acc[col.key] = tasks
        .filter((t) => t.status === col.key)
        .sort((a, b) => a.position - b.position);
      return acc;
    },
    { todo: [], in_progress: [], in_review: [], done: [] },
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  }, [tasks]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    // Determine target column: over could be a column key or another task's id
    const targetColumn = COLUMNS.find((c) => c.key === overId)?.key
      ?? tasks.find((t) => t.id === overId)?.status;

    if (!targetColumn || targetColumn === activeTask.status) return;

    // Optimistically update column
    setTasks((prev) =>
      prev.map((t) =>
        t.id === activeId
          ? { ...t, status: targetColumn as TaskStatus }
          : t,
      ),
    );
  }, [tasks]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    // Target column
    const targetColumn: TaskStatus =
      (COLUMNS.find((c) => c.key === overId)?.key as TaskStatus | undefined) ??
      (tasks.find((t) => t.id === overId)?.status as TaskStatus | undefined) ??
      activeTask.status;

    // Calculate new position: index within target column
    const columnTasks = tasks
      .filter((t) => t.status === targetColumn && t.id !== activeId)
      .sort((a, b) => a.position - b.position);

    const overTaskIndex = columnTasks.findIndex((t) => t.id === overId);
    const newPosition = overTaskIndex >= 0 ? overTaskIndex : columnTasks.length;

    // Optimistic final update
    setTasks((prev) => {
      const updated = prev.map((t) =>
        t.id === activeId
          ? { ...t, status: targetColumn, position: newPosition }
          : t,
      );
      return updated;
    });

    // Persist to server
    moveTask.mutate({ id: activeId, status: targetColumn, position: newPosition });
  }, [tasks, moveTask]);

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    setDrawerOpen(true);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              id={col.key}
              className="flex flex-col gap-2"
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {grouped[col.key].length}
                </span>
              </div>

              {/* Drop zone */}
              <div
                className={`flex flex-col gap-2 min-h-[140px] rounded-lg p-2 ${col.color}`}
              >
                <SortableContext
                  items={grouped[col.key].map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                  id={col.key}
                >
                  {grouped[col.key].length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No tasks
                    </p>
                  ) : (
                    grouped[col.key].map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        onSelect={handleSelectTask}
                      />
                    ))
                  )}
                </SortableContext>

                {/* Add task button at bottom of column */}
                <CreateTaskDialog projectId={projectId} defaultStatus={col.key} />
              </div>
            </div>
          ))}
        </div>

        {/* Drag overlay — floating preview */}
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              onClick={() => {}}
              isDragging={false}
              style={{ transform: 'rotate(2deg)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Task detail drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        projectId={projectId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedTask(null); }}
      />
    </>
  );
}
```

- [ ] **Step 4: Update ProjectList — add color swatch to ProjectCard**

Open `apps/web/components/projects/project-list.tsx`. In the `ProjectCard` function, add a color swatch before the `CardTitle`. Replace the `CardHeader` content block:

```typescript
// Inside ProjectCard, replace the <CardHeader> block with:
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: project.color ?? '#3B82F6' }}
            />
            <CardTitle className="text-base font-semibold line-clamp-2">
              {project.name}
            </CardTitle>
          </div>
          <Badge variant={STATUS_VARIANT[project.status]} className="shrink-0 capitalize">
            {project.status.replace('_', ' ')}
          </Badge>
        </div>
        {project.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {project.description}
          </p>
        )}
      </CardHeader>
```

---

## Task SP9-T6: Pages

**Files:**
- Modify: `apps/web/app/(dashboard)/projects/[id]/page.tsx`

The `projects/page.tsx` and `projects/[id]/page.tsx` files already exist and import `KanbanBoard`. SP9-T6 adds a Board/List tab switcher to the detail page and updates the project page to use the new color-aware `CreateProjectDialog`.

- [ ] **Step 1: Update project detail page with Board/List tabs**

Replace `apps/web/app/(dashboard)/projects/[id]/page.tsx`:

```typescript
// apps/web/app/(dashboard)/projects/[id]/page.tsx
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { KanbanBoard } from '@/components/projects/kanban-board';
import { MilestoneList } from '@/components/projects/milestone-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProject, type ProjectStatus, type Task, type TaskPriority, type TaskStatus } from '@/hooks/use-projects';
import { ArrowLeft, CalendarDays, LayoutKanban, List } from 'lucide-react';

const STATUS_VARIANT: Record<
  ProjectStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  completed: 'secondary',
  on_hold: 'outline',
  archived: 'destructive',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function TaskListView({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No tasks yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Due Date</TableHead>
          <TableHead>Assignee</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const overdue =
            task.dueDate && task.status !== 'done'
              ? new Date(task.dueDate) < new Date(new Date().toDateString())
              : false;

          return (
            <TableRow key={task.id}>
              <TableCell className="font-medium">{task.title}</TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {STATUS_LABELS[task.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${
                    PRIORITY_COLORS[task.priority]
                  }`}
                >
                  {task.priority}
                </span>
              </TableCell>
              <TableCell
                className={overdue ? 'text-red-600 font-semibold' : ''}
              >
                {task.dueDate
                  ? new Date(task.dueDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs">
                {task.assigneeId ? task.assigneeId.slice(0, 8) + '…' : '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, isError } = useProject(id);
  const [view, setView] = useState<'board' | 'list'>('board');

  if (isLoading) {
    return (
      <>
        <Header title="Project" />
        <div className="p-6 space-y-6 max-w-7xl">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        <Header title="Project" />
        <div className="p-6 text-center text-muted-foreground">
          <p>Project not found or you don&apos;t have access.</p>
          <Button
            variant="link"
            onClick={() => router.push('/projects')}
            className="mt-2"
          >
            Back to Projects
          </Button>
        </div>
      </>
    );
  }

  const { project, tasks, milestones } = data;
  const doneTasks = tasks.filter((t) => t.status === 'done').length;

  return (
    <>
      <Header title={project.name} />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Back + project header */}
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5"
            onClick={() => router.push('/projects')}
            aria-label="Back to projects"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div
                className="h-4 w-4 rounded-full shrink-0"
                style={{ backgroundColor: project.color ?? '#3B82F6' }}
              />
              <h1 className="text-xl font-bold truncate">{project.name}</h1>
              <Badge
                variant={STATUS_VARIANT[project.status]}
                className="capitalize"
              >
                {project.status.replace('_', ' ')}
              </Badge>
            </div>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {project.description}
              </p>
            )}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span>
                {doneTasks} / {tasks.length} tasks done
              </span>
              {project.deadline && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Deadline:{' '}
                  {new Date(project.deadline).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* View toggle tabs */}
        <div className="flex items-center gap-1 border-b pb-1">
          <Button
            variant={view === 'board' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('board')}
          >
            <LayoutKanban className="mr-1.5 h-3.5 w-3.5" />
            Board
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('list')}
          >
            <List className="mr-1.5 h-3.5 w-3.5" />
            List
          </Button>
        </div>

        {/* Task area */}
        {view === 'board' ? (
          <KanbanBoard tasks={tasks} projectId={id} />
        ) : (
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">All Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskListView tasks={tasks} />
            </CardContent>
          </Card>
        )}

        {/* Milestones */}
        <Card>
          <CardContent className="pt-5">
            <MilestoneList milestones={milestones} projectId={id} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

**Note:** This page uses `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow` from shadcn/ui. If not already installed:
```bash
cd apps/web && npx shadcn-ui@latest add table
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. Common issues and fixes:
- `TaskCard` forwarded ref type mismatch — ensure `forwardRef<HTMLDivElement, TaskCardProps>` is used and the ref is on the wrapping `<div>`.
- `@dnd-kit` types not found — verify `npm install` completed successfully.
- Missing shadcn `Sheet` or `Table` — run the add commands listed above.

---

## Verification Checklist

Run these checks after all tasks are complete:

```bash
# 1. Backend unit tests
cd apps/api && npx jest --no-coverage 2>&1 | tail -10

# 2. Backend TypeScript check
cd apps/api && npx tsc --noEmit 2>&1 | head -20

# 3. Frontend TypeScript check
cd apps/web && npx tsc --noEmit 2>&1 | head -20

# 4. Confirm @dnd-kit packages are present
grep -E "@dnd-kit" apps/web/package.json
```

Expected results:
- All Jest tests pass
- No TypeScript errors in either `apps/api` or `apps/web`
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` appear in `apps/web/package.json`

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Migration 014 uses `ADD COLUMN IF NOT EXISTS` | Safe for re-runs; does not break existing data in `005_projects_schema` |
| Task `position` is 0-based per column | Simpler than global ordering; drag-and-drop calculates position relative to sibling tasks in the target column |
| `moveTask` only updates `status` + `position` | Keeps the move path atomic and fast; avoids re-ordering all sibling positions on every drop |
| Optimistic UI in KanbanBoard | Tasks re-order instantly on drop; React Query refetch corrects any drift |
| `TaskDetailDrawer` uses `isDirty` flag | Prevents accidental saves; Save button only activates after a field change |
| Comments are append-only | Simplifies the data model; no edit/delete for comments in this sprint |
| Color stored as `VARCHAR(7)` | Exact length for `#RRGGBB` hex format; validated with regex in DTO |
| `@dnd-kit` over `react-beautiful-dnd` | Actively maintained, supports pointer and touch sensors, works with React 18 strict mode |
