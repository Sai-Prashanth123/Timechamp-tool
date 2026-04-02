'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useClockStatus, useClockIn, useClockOut } from '@/hooks/use-time-tracking';

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const update = () => {
      const ms = Date.now() - new Date(since).getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setElapsed(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    };
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <p className="text-4xl font-mono font-bold text-slate-800 tabular-nums">
      {elapsed}
    </p>
  );
}

export function ClockWidget() {
  const { data: status, isLoading } = useClockStatus();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const isClockedIn = !!status?.clockIn && !status?.clockOut;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-6">
        {isClockedIn ? (
          <>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-slate-500">Working since</p>
              <p className="text-sm font-medium text-slate-700">
                {new Date(status!.clockIn).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              <ElapsedTimer since={status!.clockIn} />
            </div>
            <Button
              size="lg"
              variant="destructive"
              className="w-40"
              disabled={clockOut.isPending}
              onClick={() => clockOut.mutate({})}
            >
              {clockOut.isPending ? 'Clocking out...' : 'Clock Out'}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-slate-500">Not clocked in</p>
              <p className="text-2xl font-semibold text-slate-400">--:--:--</p>
            </div>
            <Button
              size="lg"
              className="w-40 bg-green-600 hover:bg-green-700 text-white"
              disabled={clockIn.isPending}
              onClick={() => clockIn.mutate({})}
            >
              {clockIn.isPending ? 'Clocking in...' : 'Clock In'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
