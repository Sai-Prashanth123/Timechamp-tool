import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type GpsLocation = {
  id: string;
  userId: string;
  organizationId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  batteryLevel: number | null;
  recordedAt: string;
  createdAt: string;
};

export type Geofence = {
  id: string;
  organizationId: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  autoClockIn: boolean;
  autoClockOut: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateGeofencePayload = {
  name: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  autoClockIn?: boolean;
  autoClockOut?: boolean;
};

export type UpdateGeofencePayload = Partial<CreateGeofencePayload> & {
  isActive?: boolean;
};

export type CheckGeofenceResult = {
  isInside: boolean;
  distanceMeters: number;
  geofence: Geofence;
};

// ── GPS location history ────────────────────────────────────────────────

export function useGpsLocations(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['gps-locations', params],
    queryFn: async () => {
      const { data } = await api.get('/gps/locations', { params });
      return data.data as GpsLocation[];
    },
    enabled: Boolean(params.from && params.to),
  });
}

// ── Live locations (most recent per employee) ───────────────────────────

export function useGpsLive() {
  return useQuery({
    queryKey: ['gps-live'],
    queryFn: async () => {
      const { data } = await api.get('/gps/locations/live');
      return data.data as GpsLocation[];
    },
    refetchInterval: 60_000, // refresh every 60s
  });
}

// ── Geofences ───────────────────────────────────────────────────────────

export function useGeofences() {
  return useQuery({
    queryKey: ['geofences'],
    queryFn: async () => {
      const { data } = await api.get('/gps/geofences');
      return data.data as Geofence[];
    },
  });
}

export function useCreateGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateGeofencePayload) => {
      const { data } = await api.post('/gps/geofences', payload);
      return data.data as Geofence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success('Geofence created');
    },
    onError: (err: any) => {
      const msg: string =
        err?.response?.data?.message ?? err?.message ?? 'Failed to create geofence';
      toast.error(msg);
    },
  });
}

export function useUpdateGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateGeofencePayload }) => {
      const { data } = await api.patch(`/gps/geofences/${id}`, payload);
      return data.data as Geofence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success('Geofence updated');
    },
    onError: (err: any) => {
      const msg: string =
        err?.response?.data?.message ?? err?.message ?? 'Failed to update geofence';
      toast.error(msg);
    },
  });
}

export function useDeleteGeofence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/gps/geofences/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      toast.success('Geofence deleted');
    },
    onError: (err: any) => {
      const msg: string =
        err?.response?.data?.message ?? err?.message ?? 'Failed to delete geofence';
      toast.error(msg);
    },
  });
}
