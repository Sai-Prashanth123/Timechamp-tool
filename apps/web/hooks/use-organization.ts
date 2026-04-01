import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export function useOrganization() {
  return useQuery({
    queryKey: ['organization'],
    queryFn: async () => {
      const { data } = await api.get('/organizations/me');
      return data.data as {
        id: string;
        name: string;
        slug: string;
        plan: string;
        seats: number;
        timezone: string | null;
        website: string | null;
        logoUrl: string | null;
      };
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name?: string;
      timezone?: string;
      website?: string;
    }) => {
      const { data } = await api.patch('/organizations/me', payload);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Organization updated successfully');
    },
    onError: () => toast.error('Failed to update organization'),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      return data.data as Array<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: 'admin' | 'manager' | 'employee';
        isActive: boolean;
        emailVerified: boolean;
        createdAt: string;
      }>;
    },
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      email: string;
      role: 'admin' | 'manager' | 'employee';
    }) => {
      const { data } = await api.post('/users/invite', payload);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Invitation sent successfully');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to invite user';
      toast.error(message);
    },
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: async () => {
      const { data } = await api.get('/billing/subscription');
      return data.data as {
        id: string;
        status: 'active' | 'trialing' | 'past_due' | 'canceled';
        seats: number;
        plan: string | null;
        currentPeriodEnd: string | null;
        stripeSubscriptionId: string | null;
      } | null;
    },
  });
}
