'use client';

import { useMonitoringSocket } from '@/hooks/use-monitoring-socket';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  useMonitoringSocket();
  return <>{children}</>;
}
