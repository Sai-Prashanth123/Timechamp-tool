import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Project } from '../../database/entities/project.entity';
import { Task } from '../../database/entities/task.entity';
import { Milestone } from '../../database/entities/milestone.entity';
import { TaskComment } from '../../database/entities/task-comment.entity';

type MockRepo<T = any> = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

function mockRepo<T>(): MockRepo<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectRepo: MockRepo<Project>;
  let taskRepo: MockRepo<Task>;
  let milestoneRepo: MockRepo<Milestone>;
  let commentRepo: MockRepo<TaskComment>;

  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';
  const PROJECT_ID = 'proj-1';
  const TASK_ID = 'task-1';
  const MILESTONE_ID = 'ms-1';
  const COMMENT_ID = 'comment-1';

  beforeEach(async () => {
    projectRepo = mockRepo<Project>();
    taskRepo = mockRepo<Task>();
    milestoneRepo = mockRepo<Milestone>();
    commentRepo = mockRepo<TaskComment>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(Milestone), useValue: milestoneRepo },
        { provide: getRepositoryToken(TaskComment), useValue: commentRepo },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  // ── getProjects ────────────────────────────────────────────────────
  describe('getProjects', () => {
    it('returns all projects for the organization', async () => {
      const projects: Partial<Project>[] = [
        { id: PROJECT_ID, organizationId: ORG_ID, name: 'Alpha', status: 'active' },
        { id: 'proj-2', organizationId: ORG_ID, name: 'Beta', status: 'completed' },
      ];
      projectRepo.find.mockResolvedValue(projects);

      const result = await service.getProjects(ORG_ID);

      expect(projectRepo.find).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alpha');
    });

    it('returns empty array when no projects exist', async () => {
      projectRepo.find.mockResolvedValue([]);
      const result = await service.getProjects(ORG_ID);
      expect(result).toEqual([]);
    });
  });

  // ── createProject ──────────────────────────────────────────────────
  describe('createProject', () => {
    it('creates and returns a new project', async () => {
      const dto = { name: 'New Project', description: 'desc' };
      const created: Partial<Project> = {
        id: PROJECT_ID,
        organizationId: ORG_ID,
        name: 'New Project',
        description: 'desc',
        status: 'active',
        deadline: null,
        createdBy: USER_ID,
      };
      projectRepo.create.mockReturnValue(created);
      projectRepo.save.mockResolvedValue(created);

      const result = await service.createProject(ORG_ID, USER_ID, dto);

      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          createdBy: USER_ID,
          name: 'New Project',
          description: 'desc',
          status: 'active',
        }),
      );
      expect(projectRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(PROJECT_ID);
    });
  });

  // ── getProjectWithDetails ──────────────────────────────────────────
  describe('getProjectWithDetails', () => {
    it('returns project with tasks and milestones when found in org', async () => {
      const project: Partial<Project> = {
        id: PROJECT_ID,
        organizationId: ORG_ID,
        name: 'Alpha',
      };
      const tasks: Partial<Task>[] = [
        { id: TASK_ID, projectId: PROJECT_ID, title: 'Task 1', status: 'todo' },
      ];
      const milestones: Partial<Milestone>[] = [
        { id: MILESTONE_ID, projectId: PROJECT_ID, name: 'M1', completedAt: null },
      ];
      projectRepo.findOne.mockResolvedValue(project);
      taskRepo.find.mockResolvedValue(tasks);
      milestoneRepo.find.mockResolvedValue(milestones);

      const result = await service.getProjectWithDetails(PROJECT_ID, ORG_ID);

      expect(result.project.id).toBe(PROJECT_ID);
      expect(result.tasks).toHaveLength(1);
      expect(result.milestones).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Task 1');
    });

    it('throws NotFoundException when project does not exist', async () => {
      projectRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getProjectWithDetails('nonexistent', ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateProject ──────────────────────────────────────────────────
  describe('updateProject', () => {
    it('updates and returns the project', async () => {
      const existing: Partial<Project> = {
        id: PROJECT_ID,
        organizationId: ORG_ID,
        name: 'Alpha',
        status: 'active',
      };
      const updated = { ...existing, status: 'completed' };
      projectRepo.findOne.mockResolvedValue(existing);
      projectRepo.save.mockResolvedValue(updated);

      const result = await service.updateProject(PROJECT_ID, ORG_ID, {
        status: 'completed',
      });

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(result.status).toBe('completed');
    });

    it('throws NotFoundException when project not found', async () => {
      projectRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateProject('bad-id', ORG_ID, { status: 'archived' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── archiveProject ─────────────────────────────────────────────────
  describe('archiveProject', () => {
    it('sets project status to archived', async () => {
      const existing: Partial<Project> = {
        id: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'active',
      };
      projectRepo.findOne.mockResolvedValue(existing);
      projectRepo.save.mockResolvedValue({ ...existing, status: 'archived' });

      await service.archiveProject(PROJECT_ID, ORG_ID);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'archived' }),
      );
    });

    it('throws NotFoundException for unknown project', async () => {
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.archiveProject('bad-id', ORG_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getTasks ───────────────────────────────────────────────────────
  describe('getTasks', () => {
    it('returns tasks scoped to org and project', async () => {
      const tasks: Partial<Task>[] = [
        { id: TASK_ID, projectId: PROJECT_ID, organizationId: ORG_ID },
      ];
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.find.mockResolvedValue(tasks);

      const result = await service.getTasks(PROJECT_ID, ORG_ID);

      expect(taskRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT_ID, organizationId: ORG_ID } }),
      );
      expect(result).toHaveLength(1);
    });

    it('throws ForbiddenException when project belongs to different org', async () => {
      projectRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getTasks(PROJECT_ID, 'wrong-org'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── createTask ─────────────────────────────────────────────────────
  describe('createTask', () => {
    it('creates and returns a task', async () => {
      const dto = { title: 'New Task', priority: 'high' as const };
      const created: Partial<Task> = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        title: 'New Task',
        priority: 'high',
        status: 'todo',
      };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.create.mockReturnValue(created);
      taskRepo.save.mockResolvedValue(created);

      const result = await service.createTask(PROJECT_ID, ORG_ID, dto);

      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, organizationId: ORG_ID, title: 'New Task' }),
      );
      expect(result.id).toBe(TASK_ID);
    });
  });

  // ── updateTask ─────────────────────────────────────────────────────
  describe('updateTask', () => {
    it('changes task status', async () => {
      const existing: Partial<Task> = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'todo',
      };
      const updated = { ...existing, status: 'in_progress' };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(existing);
      taskRepo.save.mockResolvedValue(updated);

      const result = await service.updateTask(PROJECT_ID, TASK_ID, ORG_ID, {
        status: 'in_progress',
      });

      expect(taskRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_progress' }),
      );
      expect(result.status).toBe('in_progress');
    });

    it('throws ForbiddenException when task belongs to a different org', async () => {
      projectRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateTask(PROJECT_ID, TASK_ID, 'wrong-org', { status: 'done' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when task does not exist', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateTask(PROJECT_ID, 'bad-task', ORG_ID, { status: 'done' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteTask ─────────────────────────────────────────────────────
  describe('deleteTask', () => {
    it('deletes the task', async () => {
      const existing: Partial<Task> = { id: TASK_ID, projectId: PROJECT_ID, organizationId: ORG_ID };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(existing);
      taskRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteTask(PROJECT_ID, TASK_ID, ORG_ID);

      expect(taskRepo.delete).toHaveBeenCalledWith(TASK_ID);
    });
  });

  // ── moveTask ───────────────────────────────────────────────────────
  describe('moveTask', () => {
    it('updates status and position on the task', async () => {
      const existing: Partial<Task> = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        status: 'todo',
        position: 0,
      };
      const updated = { ...existing, status: 'in_progress', position: 2 };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(existing);
      taskRepo.save.mockResolvedValue(updated);

      const result = await service.moveTask(PROJECT_ID, TASK_ID, ORG_ID, {
        status: 'in_progress',
        position: 2,
      });

      expect(taskRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_progress', position: 2 }),
      );
      expect(result.status).toBe('in_progress');
      expect(result.position).toBe(2);
    });

    it('throws ForbiddenException when project is not in org', async () => {
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
      const task: Partial<Task> = { id: TASK_ID, projectId: PROJECT_ID, organizationId: ORG_ID };
      const comment: Partial<TaskComment> = {
        id: COMMENT_ID,
        taskId: TASK_ID,
        userId: USER_ID,
        content: 'Looks good!',
      };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.create.mockReturnValue(comment);
      commentRepo.save.mockResolvedValue(comment);

      const result = await service.addComment(PROJECT_ID, TASK_ID, ORG_ID, USER_ID, 'Looks good!');

      expect(commentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: TASK_ID, userId: USER_ID, content: 'Looks good!' }),
      );
      expect(result.id).toBe(COMMENT_ID);
    });

    it('throws NotFoundException when task does not exist', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addComment(PROJECT_ID, 'bad-task', ORG_ID, USER_ID, 'comment'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getComments ────────────────────────────────────────────────────
  describe('getComments', () => {
    it('returns comments for a task ordered by createdAt ASC', async () => {
      const task: Partial<Task> = { id: TASK_ID, projectId: PROJECT_ID, organizationId: ORG_ID };
      const comments: Partial<TaskComment>[] = [
        { id: COMMENT_ID, taskId: TASK_ID, content: 'First' },
        { id: 'comment-2', taskId: TASK_ID, content: 'Second' },
      ];
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.find.mockResolvedValue(comments);

      const result = await service.getComments(PROJECT_ID, TASK_ID, ORG_ID);

      expect(commentRepo.find).toHaveBeenCalledWith({
        where: { taskId: TASK_ID },
        order: { createdAt: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });

    it('throws NotFoundException when task does not exist', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      taskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getComments(PROJECT_ID, 'bad-task', ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getMilestones ──────────────────────────────────────────────────
  describe('getMilestones', () => {
    it('returns milestones for the project in the org', async () => {
      const milestones: Partial<Milestone>[] = [
        { id: MILESTONE_ID, projectId: PROJECT_ID, organizationId: ORG_ID, name: 'M1' },
      ];
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      milestoneRepo.find.mockResolvedValue(milestones);

      const result = await service.getMilestones(PROJECT_ID, ORG_ID);

      expect(result).toHaveLength(1);
    });
  });

  // ── createMilestone ────────────────────────────────────────────────
  describe('createMilestone', () => {
    it('creates and returns a milestone', async () => {
      const dto = { name: 'Launch', dueDate: '2026-06-01T00:00:00.000Z' };
      const created: Partial<Milestone> = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        name: 'Launch',
        completedAt: null,
      };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      milestoneRepo.create.mockReturnValue(created);
      milestoneRepo.save.mockResolvedValue(created);

      const result = await service.createMilestone(PROJECT_ID, ORG_ID, dto);

      expect(milestoneRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, organizationId: ORG_ID, name: 'Launch' }),
      );
      expect(result.id).toBe(MILESTONE_ID);
    });
  });

  // ── updateMilestone ────────────────────────────────────────────────
  describe('updateMilestone', () => {
    it('marks milestone as complete when markComplete is true', async () => {
      const existing: Partial<Milestone> = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        name: 'M1',
        completedAt: null,
      };
      const now = new Date();
      const updated = { ...existing, completedAt: now };
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      milestoneRepo.findOne.mockResolvedValue(existing);
      milestoneRepo.save.mockResolvedValue(updated);

      const result = await service.updateMilestone(PROJECT_ID, MILESTONE_ID, ORG_ID, {
        markComplete: true,
      });

      expect(milestoneRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: expect.any(Date) }),
      );
      expect(result.completedAt).not.toBeNull();
    });

    it('throws NotFoundException for unknown milestone', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT_ID, organizationId: ORG_ID });
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateMilestone(PROJECT_ID, 'bad-ms', ORG_ID, { markComplete: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
