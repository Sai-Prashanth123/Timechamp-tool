import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type AttendanceRecord = {
  id: string;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  locationLat: number | null;
  locationLng: number | null;
  note: string | null;
  createdAt: string;
};

export type TimeEntry = {
  id: string;
  userId: string;
  attendanceId: string | null;
  startedAt: string;
  endedAt: string | null;
  source: 'automatic' | 'manual' | 'edited';
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Timesheet = {
  id: string;
  userId: string;
  weekStart: string;
  totalMinutes: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
};

// ── Clock status ───────────────────────────────────────────────────────

export function useClockStatus() {
  return useQuery({
    queryKey: ['clock-status'],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/status');
      return data.data as AttendanceRecord | null;
    },
    refetchInterval: 30_000, // refresh every 30s
  });
}

// ── Clock in ───────────────────────────────────────────────────────────

export function useClockIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { note?: string }) => {
      const { data } = await api.post('/time-tracking/clock-in', payload ?? {});
      return data.data as AttendanceRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Clocked in successfully');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to clock in';
      toast.error(message);
    },
  });
}

// ── Clock out ──────────────────────────────────────────────────────────

export function useClockOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { note?: string }) => {
      const { data } = await api.post('/time-tracking/clock-out', payload ?? {});
      return data.data as { attendance: AttendanceRecord; entry: TimeEntry };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Clocked out successfully');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to clock out';
      toast.error(message);
    },
  });
}

// ── Time entries ───────────────────────────────────────────────────────

export function useTimeEntries(params?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['time-entries', params],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/entries', {
        params,
      });
      return data.data as TimeEntry[];
    },
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      startedAt: string;
      endedAt: string;
      description?: string;
    }) => {
      const { data } = await api.post('/time-tracking/entries', payload);
      return data.data as TimeEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry added');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to add entry';
      toast.error(message);
    },
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/time-tracking/entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Entry deleted');
    },
    onError: () => toast.error('Failed to delete entry'),
  });
}

// ── Timesheets ─────────────────────────────────────────────────────────

export function useTimesheets() {
  return useQuery({
    queryKey: ['timesheets'],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/timesheets');
      return data.data as Timesheet[];
    },
  });
}

export function useSubmitTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weekStart: string) => {
      const { data } = await api.post(
        `/time-tracking/timesheets/${weekStart}/submit`,
      );
      return data.data as Timesheet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheet submitted for approval');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to submit timesheet';
      toast.error(message);
    },
  });
}

export function useApproveTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(
        `/time-tracking/timesheets/${id}/approve`,
      );
      return data.data as Timesheet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheet approved');
    },
    onError: () => toast.error('Failed to approve timesheet'),
  });
}

export function useRejectTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      rejectionNote,
    }: {
      id: string;
      rejectionNote: string;
    }) => {
      const { data } = await api.post(
        `/time-tracking/timesheets/${id}/reject`,
        { rejectionNote },
      );
      return data.data as Timesheet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheet rejected');
    },
    onError: () => toast.error('Failed to reject timesheet'),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Returns total hours formatted as "Xh Ym" from totalMinutes */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Returns the Monday (week_start) of the week containing date */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day; // offset to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
