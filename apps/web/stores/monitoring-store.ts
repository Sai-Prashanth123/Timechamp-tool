import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

export type EmployeeStatus = {
  userId: string;
  status: 'online' | 'idle' | 'offline';
  activeApp: string | null;
  lastSeen: string; // ISO string
};

interface MonitoringStore {
  employees: Record<string, EmployeeStatus>;
  employeeNames: Record<string, { firstName: string; lastName: string }>;
  socket: Socket | null;
  connected: boolean;

  connect: (token: string, apiUrl: string) => void;
  disconnect: () => void;
  _setStatus: (payload: EmployeeStatus) => void;
  _setActivity: (userId: string, appName: string, timestamp: string) => void;
  _seedNames: (employees: Array<{ userId: string; firstName: string; lastName: string }>) => void;
}

export const useMonitoringStore = create<MonitoringStore>((set, get) => ({
  employees: {},
  employeeNames: {},
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
    });

    socket.on('employee:activity', (payload: {
      userId: string;
      appName: string;
      timestamp: string;
    }) => {
      get()._setActivity(payload.userId, payload.appName, payload.timestamp);
    });

    set({ socket });
  },

  disconnect() {
    get().socket?.disconnect();
    set({ socket: null, connected: false });
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
}));
