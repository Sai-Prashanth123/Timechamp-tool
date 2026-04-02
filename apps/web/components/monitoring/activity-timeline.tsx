'use client';

import { useActivity } from '@/hooks/use-monitoring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// 20 distinct colours cycling for app names
const COLOURS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#f43f5e', '#a3e635', '#fb923c', '#c084fc',
  '#34d399', '#fbbf24', '#60a5fa', '#e879f9', '#4ade80',
];

const appColor = (() => {
  const map = new Map<string, string>();
  let idx = 0;
  return (name: string) => {
    if (!map.has(name)) map.set(name, COLOURS[idx++ % COLOURS.length]);
    return map.get(name)!;
  };
})();

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface Props {
  userId?: string;
  from?: string;
  to?: string;
}

export function ActivityTimeline({ userId, from, to }: Props) {
  const { data: events = [], isLoading } = useActivity({ userId, from, to });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading activity...
        </CardContent>
      </Card>
    );
  }

  // Group by app, sum durations
  const appTotals = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.appName] = (acc[e.appName] ?? 0) + e.durationSec;
    return acc;
  }, {});
  const sorted = Object.entries(appTotals).sort((a, b) => b[1] - a[1]);
  const totalSec = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Usage</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No activity recorded for this period.
          </p>
        ) : (
          <div className="space-y-2.5">
            {sorted.slice(0, 15).map(([app, sec]) => (
              <div key={app} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-sm text-slate-700 truncate" title={app}>
                  {app}
                </div>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, (sec / totalSec) * 100)}%`,
                      backgroundColor: appColor(app),
                    }}
                  />
                </div>
                <div className="w-16 shrink-0 text-xs text-slate-500 text-right">
                  {fmtDuration(sec)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
