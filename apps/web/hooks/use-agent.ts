import { useMutation, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export type AgentDevice = {
  id: string;
  hostname: string | null;
  platform: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  isActive: boolean;
  createdAt: string;
};

export function useAgentDevices() {
  return useQuery({
    queryKey: ['agent-devices'],
    queryFn: async () => {
      const { data } = await api.get('/agent/devices');
      return data.data as AgentDevice[];
    },
  });
}

export function useGenerateInviteToken() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/agent/invite-token');
      return data.data as { token: string };
    },
    onError: () => toast.error('Failed to generate invite token'),
  });
}
