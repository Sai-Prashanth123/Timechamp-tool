// apps/web/hooks/use-alerts.ts
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type AlertType =
  | 'idle_too_long'
  | 'overtime'
  | 'late_clock_in'
  | 'productivity_below';

export type AlertRule = {
  id: string;
  organizationId: string;
  name: string;
  type: AlertType;
  threshold: number;
  enabled: boolean;
  notifyEmail: boolean;
  notifyInApp: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AlertEvent = {
  id: string;
  organizationId: string;
  ruleId: string | null;
  userId: string;
  type: AlertType | null;
  message: string | null;
  seenAt: string | null;
  triggeredAt: string;
  createdAt: string;
  rule?: AlertRule | null;
};

export type CreateAlertRulePayload = {
  name: string;
  type: AlertType;
  threshold?: number;
  enabled?: boolean;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
};

export type UpdateAlertRulePayload = Partial<CreateAlertRulePayload> & { id: string };

// ── Label maps ─────────────────────────────────────────────────────────

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  idle_too_long:        'Idle Too Long',
  overtime:             'Overtime',
  late_clock_in:        'Late Clock-In',
  productivity_below:   'Low Productivity',
};

export const ALERT_TYPE_ICONS: Record<AlertType, string> = {
  idle_too_long:        '💤',
  overtime:             '⏰',
  late_clock_in:        '🕐',
  productivity_below:   '📉',
};

export const ALERT_TYPES: AlertType[] = [
  'idle_too_long',
  'overtime',
  'late_clock_in',
  'productivity_below',
];

// ── Alert Rules ────────────────────────────────────────────────────────

export function useAlertRules() {
  return useQuery({
    queryKey: ['alert-rules'],
    queryFn: async () => {
      const { data } = await api.get('/alerts/rules');
      return data.data as AlertRule[];
    },
  });
}

export function useCreateAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAlertRulePayload) => {
      const { data } = await api.post('/alerts/rules', payload);
      return data.data as AlertRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Alert rule created');
    },
    onError: (err: unknown) => {
      toast.error((err as any)?.response?.data?.message ?? 'Failed to create alert rule');
    },
  });
}

export function useUpdateAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateAlertRulePayload) => {
      const { data } = await api.patch(`/alerts/rules/${id}`, payload);
      return data.data as AlertRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Alert rule updated');
    },
    onError: (err: unknown) => {
      toast.error((err as any)?.response?.data?.message ?? 'Failed to update alert rule');
    },
  });
}

export function useDeleteAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/alerts/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Alert rule deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as any)?.response?.data?.message ?? 'Failed to delete alert rule');
    },
  });
}

// ── Alert Events ───────────────────────────────────────────────────────

export function useAlertEvents(userId?: string) {
  return useQuery({
    queryKey: ['alert-events', userId],
    queryFn: async () => {
      const params = userId ? `?userId=${userId}` : '';
      const { data } = await api.get(`/alerts/events${params}`);
      return data.data as AlertEvent[];
    },
    refetchInterval: 60_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['alert-unread-count'],
    queryFn: async () => {
      const { data } = await api.get('/alerts/events/unread-count');
      return (data as { count: number }).count;
    },
    refetchInterval: 30_000,
  });
}

export function useMarkSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/alerts/events/${id}/seen`);
      return data.data as AlertEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-events'] });
      queryClient.invalidateQueries({ queryKey: ['alert-unread-count'] });
    },
    onError: (err: unknown) => {
      toast.error((err as any)?.response?.data?.message ?? 'Failed to mark alert as seen');
    },
  });
}
