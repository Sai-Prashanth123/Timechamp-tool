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
        // Number of active agent devices this user has registered. Set
        // to 0 if they haven't installed the desktop agent yet. Used by
        // /settings/users to render a "Agents" column badge.
        deviceCount: number;
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

// ── Invoices ────────────────────────────────────────────────────────────

export type Invoice = {
  id: string;
  number: string | null;
  amount: number;       // cents
  currency: string;
  status: string | null;
  created: number;      // Unix timestamp
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

export function useInvoices() {
  return useQuery({
    queryKey: ['billing-invoices'],
    queryFn: async () => {
      const { data } = await api.get('/billing/invoices');
      return data.data as Invoice[];
    },
  });
}

// ── Checkout ────────────────────────────────────────────────────────────

export function useCheckout() {
  return useMutation({
    mutationFn: async (payload: { priceId: string; seats: number }) => {
      const { data } = await api.post('/billing/checkout', payload);
      return data.data as { url: string };
    },
    onSuccess: ({ url }: { url: string }) => {
      window.location.href = url;
    },
    onError: () => toast.error('Failed to create checkout session. Please try again.'),
  });
}
