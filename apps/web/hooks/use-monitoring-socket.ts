'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useMonitoringStore } from '@/stores/monitoring-store';

export function useMonitoringSocket() {
  const { data: session } = useSession();
  const connect = useMonitoringStore((s) => s.connect);
  const disconnect = useMonitoringStore((s) => s.disconnect);

  const role = session?.user?.role;
  const token = (session as any)?.accessToken as string | undefined;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  useEffect(() => {
    if (!token || (role !== 'admin' && role !== 'manager')) return;
    connect(token, apiUrl);
    return () => disconnect();
  }, [token, role, apiUrl, connect, disconnect]);
}
