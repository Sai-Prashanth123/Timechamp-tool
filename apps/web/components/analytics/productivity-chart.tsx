'use client';

import { useProductivity } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'; // green-500
  if (score >= 40) return '#f59e0b'; // amber-500
  return '#ef4444';                  // red-500
}

function scoreLabel(score: number): string {
  if (score >= 70) return 'Productive';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

interface Props {
  from: string;
  to: string;
  userId?: string;
}

export function ProductivityChart({ from, to, userId }: Props) {
  const { data: days = [], isLoading } = useProductivity({ from, to, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading productivity data...
        </CardContent>
      </Card>
    );
  }

  // Only show days that had any worked time
  const activeDays = days.filter((d) => d.workedMins > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Productivity Score</CardTitle>
      </CardHeader>
      <CardContent>
        {activeDays.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No working hours recorded for this period.
          </p>
        ) : (
          <div className="space-y-3">
            {activeDays.map((day) => (
              <div key={day.date} className="flex items-center gap-3">
                {/* Date label */}
                <div className="w-24 shrink-0 text-xs text-slate-500 text-right">
                  {new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>

                {/* Bar */}
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-5 rounded-full transition-all flex items-center justify-end pr-2"
                    style={{
                      width: `${Math.max(4, day.score)}%`,
                      backgroundColor: scoreColor(day.score),
                    }}
                  >
                    {day.score >= 20 && (
                      <span className="text-[10px] font-semibold text-white">
                        {day.score}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="w-40 shrink-0 text-xs text-slate-500">
                  <span
                    className="font-medium"
                    style={{ color: scoreColor(day.score) }}
                  >
                    {scoreLabel(day.score)}
                  </span>
                  {' · '}
                  {day.activeMins}m active / {day.workedMins}m worked
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
