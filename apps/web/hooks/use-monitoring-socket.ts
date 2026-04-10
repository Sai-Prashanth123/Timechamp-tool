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
  // Strip /api/v1 path — Socket.io namespaces live on the root server URL
  const rawUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
  const apiUrl = rawUrl.replace(/\/api\/v\d+\/?$/, '');

  useEffect(() => {
    if (!token || (role !== 'admin' && role !== 'manager')) return;
    connect(token, apiUrl);
    return () => disconnect();
  }, [token, role, apiUrl, connect, disconnect]);
}
