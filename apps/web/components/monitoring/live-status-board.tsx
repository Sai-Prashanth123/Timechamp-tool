'use client';

import { useLiveStatus, elapsedSince } from '@/hooks/use-monitoring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

export function LiveStatusBoard() {
  const { data: employees = [], isLoading } = useLiveStatus();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading live status...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live — {employees.length} online
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No employees currently clocked in.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {employees.map((emp) => (
              <div
                key={emp.userId}
                className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                  {initials(emp.firstName, emp.lastName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {emp.firstName} {emp.lastName}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {emp.currentApp ?? 'Idle'} · {elapsedSince(emp.clockedInSince)}
                  </p>
                </div>
                <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
