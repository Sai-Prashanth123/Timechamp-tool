import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type WebhookEndpoint = {
  id: string;
  url: string;
  secret: string | null;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  attemptCount: number;
  succeeded: boolean;
  deliveredAt: string | null;
  createdAt: string;
};

export type SlackConfig = {
  id: string;
  maskedUrl: string;
  isActive: boolean;
} | null;

export type CreateWebhookInput = {
  url: string;
  secret?: string;
  events?: string[];
};

export type UpdateWebhookInput = {
  url?: string;
  secret?: string | null;
  events?: string[];
  isActive?: boolean;
};

// ── Query Keys ─────────────────────────────────────────────────────────

const KEYS = {
  webhooks: ['integrations', 'webhooks'] as const,
  deliveries: (id: string) => ['integrations', 'webhooks', id, 'deliveries'] as const,
  slack: ['integrations', 'slack'] as const,
};

// ── Webhook hooks ──────────────────────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: KEYS.webhooks,
    queryFn: async () => {
      const { data } = await api.get('/integrations/webhooks');
      return data.data as WebhookEndpoint[];
    },
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWebhookInput) => {
      const { data } = await api.post('/integrations/webhooks', input);
      return data.data as WebhookEndpoint;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.webhooks });
      toast.success('Webhook endpoint created');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to create webhook';
      toast.error(msg);
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateWebhookInput & { id: string }) => {
      const { data } = await api.patch(`/integrations/webhooks/${id}`, input);
      return data.data as WebhookEndpoint;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.webhooks });
      toast.success('Webhook endpoint updated');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to update webhook';
      toast.error(msg);
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/integrations/webhooks/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.webhooks });
      toast.success('Webhook endpoint deleted');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to delete webhook';
      toast.error(msg);
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/integrations/webhooks/${id}/test`);
    },
    onSuccess: () => toast.success('Test ping sent'),
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to send test ping';
      toast.error(msg);
    },
  });
}

export function useDeliveries(endpointId: string) {
  return useQuery({
    queryKey: KEYS.deliveries(endpointId),
    queryFn: async () => {
      const { data } = await api.get(`/integrations/webhooks/${endpointId}/deliveries`);
      return data.data as WebhookDelivery[];
    },
    enabled: !!endpointId,
  });
}

// ── Slack hooks ────────────────────────────────────────────────────────

export function useSlackConfig() {
  return useQuery({
    queryKey: KEYS.slack,
    queryFn: async () => {
      const { data } = await api.get('/integrations/slack');
      return data.data as SlackConfig;
    },
  });
}

export function useSaveSlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (webhookUrl: string) => {
      const { data } = await api.post('/integrations/slack', { webhookUrl });
      return data.data as NonNullable<SlackConfig>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.slack });
      toast.success('Slack integration saved');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to save Slack config';
      toast.error(msg);
    },
  });
}

export function useDeleteSlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete('/integrations/slack');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.slack });
      toast.success('Slack integration removed');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to remove Slack integration';
      toast.error(msg);
    },
  });
}

export function useTestSlack() {
  return useMutation({
    mutationFn: async () => {
      await api.post('/integrations/slack/test');
    },
    onSuccess: () => toast.success('Test message sent to Slack'),
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to send Slack test';
      toast.error(msg);
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

export const ALL_WEBHOOK_EVENTS = [
  { value: 'clock.in',              label: 'Clock In' },
  { value: 'clock.out',             label: 'Clock Out' },
  { value: 'timesheet.submitted',   label: 'Timesheet Submitted' },
  { value: 'timesheet.approved',    label: 'Timesheet Approved' },
  { value: 'task.status_changed',   label: 'Task Status Changed' },
] as const;
