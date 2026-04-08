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

// ── SP7 Types ──────────────────────────────────────────────────────────

export type AppCategory = 'productive' | 'unproductive' | 'neutral';

export type ProductivityReportDay = {
  date: string;
  productiveMinutes: number;
  unproductiveMinutes: number;
  neutralMinutes: number;
  totalMinutes: number;
  topApps: { appName: string; minutes: number; category: AppCategory }[];
};

export type OrgProductivitySummaryRow = {
  userId: string;
  firstName: string;
  lastName: string;
  productivePercent: number;
  totalHours: number;
  topApp: string;
};

export type CategoryBreakdownSlice = {
  category: AppCategory;
  minutes: number;
  percent: number;
};

export type HeatmapDay = {
  date: string;
  productiveMinutes: number;
  level: 0 | 1 | 2 | 3 | 4;
};

// ── SP7 Hooks ──────────────────────────────────────────────────────────

export function useProductivityReport(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-productivity-report', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/report', { params });
      return data.data as ProductivityReportDay[];
    },
    enabled: !!(params.from && params.to),
  });
}

export function useProductivitySummary(params: {
  from: string;
  to: string;
}) {
  return useQuery({
    queryKey: ['analytics-productivity-summary', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/summary', { params });
      return data.data as OrgProductivitySummaryRow[];
    },
    enabled: !!(params.from && params.to),
  });
}

export function useCategoryBreakdown(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-category-breakdown', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/breakdown', { params });
      return data.data as CategoryBreakdownSlice[];
    },
    enabled: !!(params.from && params.to),
  });
}

export function useHeatmap(params: {
  weeks?: number;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-heatmap', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/heatmap', { params });
      return data.data as HeatmapDay[];
    },
  });
}

// ── SP7 Date Helpers ───────────────────────────────────────────────────

/** Returns { from, to } for the last N days (inclusive of today) */
export function lastNDays(n: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (n - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/** Returns { from, to } for the current Mon–Sun week */
export function thisWeek(): { from: string; to: string } {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

/** Returns { from, to } for last Mon–Sun week */
export function lastWeek(): { from: string; to: string } {
  const t = thisWeek();
  const from = new Date(t.from);
  const to = new Date(t.to);
  from.setDate(from.getDate() - 7);
  to.setDate(to.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export const last7Days = () => lastNDays(7);
export const last30Days = () => lastNDays(30);
