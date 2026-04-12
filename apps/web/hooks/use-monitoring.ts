import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * One row per live agent device — NOT per user. A single user can own
 * multiple machines and each renders as its own card on the dashboard.
 * Backend shape is defined by `LiveDevice` in monitoring.service.ts.
 */
export type LiveDevice = {
  deviceId: string;
  userId: string;
  userName: string;              // firstName + lastName, pre-joined by API
  displayName: string | null;    // user-entered label ("Sai's Laptop")
  hostname: string | null;       // fallback when displayName is null
  clockedInSince: string;
  currentApp: string | null;
  lastSeenAt: string | null;
};

export type ActivityEvent = {
  id: string;
  userId: string;
  appName: string;
  windowTitle: string | null;
  startedAt: string;
  durationSec: number;
  keystrokeCount: number;
  createdAt: string;
};

export type ScreenshotItem = {
  id: string;
  userId: string;
  capturedAt: string;
  fileSizeBytes: number;
  url: string;
};

// ── Live Status ────────────────────────────────────────────────────────

export function useLiveStatus() {
  return useQuery({
    queryKey: ['monitoring-live'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/live');
      return data.data as LiveDevice[];
    },
    refetchInterval: 30_000,
  });
}

// ── Activity ───────────────────────────────────────────────────────────

export function useActivity(params?: {
  userId?: string;
  deviceId?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: ['monitoring-activity', params],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/activity', { params });
      return data.data as ActivityEvent[];
    },
  });
}

// ── Screenshots ────────────────────────────────────────────────────────

export function useScreenshots(params?: {
  userId?: string;
  deviceId?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: ['monitoring-screenshots', params],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/screenshots', { params });
      return data.data as ScreenshotItem[];
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Elapsed time from a date string to now, formatted "Xh Ym" */
export function elapsedSince(isoString: string): string {
  const ms = Math.max(0, Date.now() - new Date(isoString).getTime());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Today's date in 'YYYY-MM-DD' format */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
