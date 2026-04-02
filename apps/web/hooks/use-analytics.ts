import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type DailyProductivity = {
  date: string;       // YYYY-MM-DD
  score: number;      // 0–100
  workedMins: number;
  activeMins: number;
  idleMins: number;
};

export type AppUsageRow = {
  appName: string;
  totalMins: number;
  percentage: number;
};

// ── Productivity ───────────────────────────────────────────────────────

export function useProductivity(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-productivity', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity', { params });
      return data.data as DailyProductivity[];
    },
  });
}

// ── App Usage ──────────────────────────────────────────────────────────

export function useAppUsage(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-app-usage', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/app-usage', { params });
      return data.data as AppUsageRow[];
    },
  });
}

// ── CSV Export ─────────────────────────────────────────────────────────

export function useExportCSV() {
  return useMutation({
    mutationFn: async (params: { from: string; to: string; userId?: string }) => {
      const response = await api.get('/analytics/export/csv', {
        params,
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `time-entries-${params.from}-${params.to}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('CSV downloaded'),
    onError: () => toast.error('Failed to export CSV'),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Today's date as 'YYYY-MM-DD' */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** N days ago as 'YYYY-MM-DD' */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
