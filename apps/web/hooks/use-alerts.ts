import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type AlertMetric = 'idle_time' | 'no_activity' | 'late_clock_in' | 'missed_clock_in';

export type AlertRule = {
  id: string;
  organizationId: string;
  name: string;
  metric: AlertMetric;
  thresholdMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AlertEvent = {
  id: string;
  organizationId: string;
  ruleId: string | null;
  userId: string;
  metric: AlertMetric;
  valueMinutes: number;
  thresholdMinutes: number;
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
};

export type CreateAlertRulePayload = {
  name: string;
  metric: AlertMetric;
  thresholdMinutes?: number;
  isActive?: boolean;
};

export type UpdateAlertRulePayload = {
  name?: string;
  metric?: AlertMetric;
  thresholdMinutes?: number;
  isActive?: boolean;
};

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
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to create alert rule';
      toast.error(message);
    },
  });
}

export function useUpdateAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateAlertRulePayload & { id: string }) => {
      const { data } = await api.patch(`/alerts/rules/${id}`, payload);
      return data.data as AlertRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      toast.success('Alert rule updated');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to update alert rule';
      toast.error(message);
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
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to delete alert rule';
      toast.error(message);
    },
  });
}

// ── Alert Events ───────────────────────────────────────────────────────

export function useAlertEvents() {
  return useQuery({
    queryKey: ['alert-events'],
    queryFn: async () => {
      const { data } = await api.get('/alerts/events');
      return data.data as AlertEvent[];
    },
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/alerts/events/${id}/acknowledge`);
      return data.data as AlertEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-events'] });
      toast.success('Alert acknowledged');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to acknowledge alert';
      toast.error(message);
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

export const METRIC_LABELS: Record<AlertMetric, string> = {
  idle_time: 'Idle Time',
  no_activity: 'No Activity',
  late_clock_in: 'Late Clock-In',
  missed_clock_in: 'Missed Clock-In',
};
