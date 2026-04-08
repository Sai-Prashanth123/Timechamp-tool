'use client';

import { useEffect } from 'react';
import { useLiveStatus, elapsedSince } from '@/hooks/use-monitoring';
import { useMonitoringStore, EmployeeStatus } from '@/stores/monitoring-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function initials(name: string): string {
  const parts = name.split(' ');
  return parts.map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function StatusBadge({ status }: { status: EmployeeStatus['status'] }) {
  const colours: Record<EmployeeStatus['status'], string> = {
    online: 'bg-green-400',
    idle: 'bg-yellow-400',
    offline: 'bg-slate-300',
  };
  return <span className={`h-2 w-2 rounded-full shrink-0 ${colours[status]}`} />;
}

export function LiveStatusBoard() {
  const { data: seedEmployees = [] } = useLiveStatus();

  const storeEmployees = useMonitoringStore((s) => s.employees);
  const storeNames = useMonitoringStore((s) => s.employeeNames);
  const _setStatus = useMonitoringStore((s) => s._setStatus);
  const _seedNames = useMonitoringStore((s) => s._seedNames);

  // Seed store with REST data on first load
  useEffect(() => {
    const nameSeeds = seedEmployees.map((emp) => ({
      userId: emp.userId,
      firstName: emp.firstName ?? emp.userId,
      lastName: emp.lastName ?? '',
    }));
    _seedNames(nameSeeds);

    for (const emp of seedEmployees) {
      _setStatus({
        userId: emp.userId,
        status: 'online',
        activeApp: emp.currentApp ?? null,
        lastSeen: emp.lastSeenAt ?? emp.clockedInSince ?? new Date().toISOString(),
      });
    }
  }, [seedEmployees, _setStatus, _seedNames]);

  const employees = Object.values(storeEmployees);
  const onlineCount = employees.filter((e) => e.status !== 'offline').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live — {onlineCount} online
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No employees currently clocked in.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {employees.map((emp) => {
              const nameEntry = storeNames[emp.userId];
              const displayName = nameEntry
                ? `${nameEntry.firstName} ${nameEntry.lastName}`.trim()
                : emp.userId;
              return (
                <a
                  key={emp.userId}
                  href={`/monitoring/${emp.userId}`}
                  className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                    {initials(displayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {displayName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {emp.activeApp ?? 'Idle'} · {elapsedSince(emp.lastSeen)}
                    </p>
                  </div>
                  <StatusBadge status={emp.status} />
                </a>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
