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
  createdAt: string;
  updatedAt: string;
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
};

export type UpdateProjectPayload = {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  deadline?: string | null;
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
      const { data } = await api.patch(`/projects/${projectId}/tasks/${id}`, payload);
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
      const { data } = await api.post(`/projects/${projectId}/milestones`, payload);
      return data.data as Milestone;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'milestones'] });
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
    mutationFn: async ({ id, ...payload }: UpdateMilestonePayload & { id: string }) => {
      const { data } = await api.patch(
        `/projects/${projectId}/milestones/${id}`,
        payload,
      );
      return data.data as Milestone;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'milestones'] });
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
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'milestones'] });
      toast.success('Milestone deleted');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to delete milestone';
      toast.error(message);
    },
  });
}
