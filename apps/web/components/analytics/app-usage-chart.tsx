'use client';

import { useAppUsage } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLOURS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#f43f5e', '#a3e635', '#fb923c', '#c084fc',
  '#34d399', '#fbbf24', '#60a5fa', '#e879f9', '#4ade80',
];

interface Props {
  from: string;
  to: string;
  userId?: string;
}

export function AppUsageChart({ from, to, userId }: Props) {
  const { data: rows = [], isLoading } = useAppUsage({ from, to, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading app usage...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Usage Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No activity recorded for this period.
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.slice(0, 20).map((row, i) => (
              <div key={row.appName} className="flex items-center gap-3">
                {/* App name */}
                <div
                  className="w-36 shrink-0 text-sm text-slate-700 truncate"
                  title={row.appName}
                >
                  {row.appName}
                </div>

                {/* Bar */}
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all"
                    style={{
                      width: `${Math.max(1, row.percentage)}%`,
                      backgroundColor: COLOURS[i % COLOURS.length],
                    }}
                  />
                </div>

                {/* Duration + % */}
                <div className="w-24 shrink-0 text-xs text-slate-500 text-right">
                  {row.totalMins >= 60
                    ? `${Math.floor(row.totalMins / 60)}h ${row.totalMins % 60}m`
                    : `${row.totalMins}m`}
                  {' · '}
                  {row.percentage}%
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
