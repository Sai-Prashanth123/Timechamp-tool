import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export type AgentDevice = {
  id: string;
  userId: string;
  hostname: string | null;
  displayName: string | null;
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

// ── Personal agent token ──────────────────────────────────────────────
//
// Each user owns a single long-lived token on `users.agent_token` that
// they paste into the desktop agent's setup UI. Rotating here does NOT
// invalidate agents that have already registered — they keep using the
// per-device token they received at registration.

export type PersonalAgentToken = { token: string; userName: string };

export function usePersonalAgentToken() {
  return useQuery({
    queryKey: ['personal-agent-token'],
    queryFn: async () => {
      const { data } = await api.get('/users/me/agent-token');
      return data.data as PersonalAgentToken;
    },
    // Tokens are single-use and auto-rotate on successful registration.
    // `staleTime: 0` + `refetchOnWindowFocus` ensures that when the user
    // switches back to the browser tab after running setup.exe, they see
    // the freshly-rotated token without having to manually click rotate.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useRotatePersonalAgentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/users/me/agent-token/rotate');
      return data.data as PersonalAgentToken;
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(['personal-agent-token'], fresh);
      toast.success('Token rotated — paste the new value into your agent setup');
    },
    onError: () => toast.error('Failed to rotate token'),
  });
}
