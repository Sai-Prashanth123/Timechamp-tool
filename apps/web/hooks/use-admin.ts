'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export function useOrgStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/stats');
      return data.data as {
        totalUsers: number;
        adminCount: number;
        activeToday: number;
        hoursThisWeek: number;
      };
    },
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data } = await api.get('/admin/users');
      return data.data as Array<{
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        role: string;
        isActive: boolean;
        createdAt: string;
      }>;
    },
  });
}

export function useChangeUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { data } = await api.patch(`/admin/users/${userId}/role`, { role });
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Role updated');
    },
    onError: () => toast.error('Failed to update role'),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.patch(`/admin/users/${userId}/deactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User deactivated');
    },
    onError: () => toast.error('Failed to deactivate user'),
  });
}

export function useReactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.patch(`/admin/users/${userId}/reactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User reactivated');
    },
    onError: () => toast.error('Failed to reactivate user'),
  });
}

export function useAuditLog(params?: {
  actorId?: string;
  action?: string;
  limit?: number;
  page?: number;
}) {
  return useQuery({
    queryKey: ['audit-log', params],
    queryFn: async () => {
      const { data } = await api.get('/admin/audit-log', { params });
      return data.data as {
        logs: Array<{
          id: string;
          actorEmail: string;
          action: string;
          resourceType: string;
          resourceId: string | null;
          createdAt: string;
        }>;
        total: number;
        page: number;
        limit: number;
      };
    },
  });
}
