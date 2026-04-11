import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

export type EmployeeStatus = {
  userId: string;
  status: 'online' | 'idle' | 'offline';
  activeApp: string | null;
  lastSeen: string; // ISO string
};

// Per-user expiring timers — client-side fallback so presence converges to
// reality even if the WS drops a message or Redis pub/sub is down. Any inbound
// event resets both timers; when they fire, status is downgraded locally.
// Layered on top of the server-side sweep cron (MonitoringService.sweepOfflineAgents).
type PresenceTimers = {
  idle?: ReturnType<typeof setTimeout>;
  offline?: ReturnType<typeof setTimeout>;
};

const IDLE_AFTER_MS = 60_000; // 1 min without events → yellow
const OFFLINE_AFTER_MS = 300_000; // 5 min without events → grey

interface MonitoringStore {
  employees: Record<string, EmployeeStatus>;
  employeeNames: Record<string, { firstName: string; lastName: string }>;
  timers: Record<string, PresenceTimers>;
  socket: Socket | null;
  connected: boolean;

  connect: (token: string, apiUrl: string) => void;
  disconnect: () => void;
  _setStatus: (payload: EmployeeStatus) => void;
  _setActivity: (userId: string, appName: string, timestamp: string) => void;
  _seedNames: (employees: Array<{ userId: string; firstName: string; lastName: string }>) => void;
  _resetPresenceTimers: (userId: string) => void;
  _downgradeStatus: (userId: string, to: 'idle' | 'offline') => void;
}

export const useMonitoringStore = create<MonitoringStore>((set, get) => ({
  employees: {},
  employeeNames: {},
  timers: {},
  socket: null,
  connected: false,

  connect(token, apiUrl) {
    if (get().socket?.connected) return;

    const socket = io(`${apiUrl}/monitoring`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));

    socket.on('employee:status', (payload: {
      userId: string;
      status: 'online' | 'idle' | 'offline';
      activeApp?: string | null;
      lastSeen: string;
    }) => {
      set((state) => ({
        employees: {
          ...state.employees,
          [payload.userId]: {
            userId: payload.userId,
            status: payload.status,
            activeApp: payload.activeApp ?? null,
            lastSeen: payload.lastSeen,
          },
        },
      }));
      // Reset the per-user TTLs — unless the server is already telling us offline.
      if (payload.status !== 'offline') {
        get()._resetPresenceTimers(payload.userId);
      }
    });

    socket.on('employee:activity', (payload: {
      userId: string;
      appName: string;
      timestamp: string;
    }) => {
      get()._setActivity(payload.userId, payload.appName, payload.timestamp);
      get()._resetPresenceTimers(payload.userId);
    });

    set({ socket });
  },

  disconnect() {
    get().socket?.disconnect();
    // Clear all pending timers to prevent leaks on unmount.
    for (const t of Object.values(get().timers)) {
      if (t.idle) clearTimeout(t.idle);
      if (t.offline) clearTimeout(t.offline);
    }
    set({ socket: null, connected: false, timers: {} });
  },

  _setStatus(payload) {
    set((state) => ({
      employees: { ...state.employees, [payload.userId]: payload },
    }));
  },

  _setActivity(userId, appName, timestamp) {
    set((state) => {
      const existing = state.employees[userId];
      if (!existing) return state;
      return {
        employees: {
          ...state.employees,
          [userId]: { ...existing, activeApp: appName, lastSeen: timestamp },
        },
      };
    });
  },

  _seedNames(employees) {
    set(() => ({
      employeeNames: Object.fromEntries(
        employees.map((e) => [e.userId, { firstName: e.firstName, lastName: e.lastName }])
      ),
    }));
  },

  _resetPresenceTimers(userId) {
    const existing = get().timers[userId];
    if (existing?.idle) clearTimeout(existing.idle);
    if (existing?.offline) clearTimeout(existing.offline);
    const fresh: PresenceTimers = {
      idle: setTimeout(() => get()._downgradeStatus(userId, 'idle'), IDLE_AFTER_MS),
      offline: setTimeout(() => get()._downgradeStatus(userId, 'offline'), OFFLINE_AFTER_MS),
    };
    set((state) => ({ timers: { ...state.timers, [userId]: fresh } }));
  },

  _downgradeStatus(userId, to) {
    set((state) => {
      const existing = state.employees[userId];
      if (!existing) return state;
      // Don't upgrade — only allow monotonic downgrade online → idle → offline.
      if (to === 'idle' && existing.status === 'offline') return state;
      return {
        employees: {
          ...state.employees,
          [userId]: { ...existing, status: to },
        },
      };
    });
  },
}));
