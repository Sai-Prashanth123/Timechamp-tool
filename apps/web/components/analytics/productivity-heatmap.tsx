'use client';

import { useHeatmap, HeatmapDay } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props { weeks?: number; userId?: string }

const LEVEL_COLORS: Record<number, string> = { 0: '#e2e8f0', 1: '#bbf7d0', 2: '#4ade80', 3: '#16a34a', 4: '#14532d' };
const LEVEL_LABELS: Record<number, string> = { 0: 'No activity', 1: 'Less than 2 hours', 2: '2–4 hours', 3: '4–6 hours', 4: '6+ hours' };
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTooltip(day: HeatmapDay): string {
  const dateStr = new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const mins = day.productiveMinutes;
  const duration = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m productive` : `${mins}m productive`;
  return `${dateStr} — ${duration}`;
}

function groupIntoWeeks(days: HeatmapDay[]): HeatmapDay[][] {
  const weeks: HeatmapDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function getMonthLabel(days: HeatmapDay[]): string | null {
  if (!days.length) return null;
  const d = new Date(`${days[0].date}T12:00:00Z`);
  return d.getUTCDate() <= 7 ? d.toLocaleDateString(undefined, { month: 'short' }) : null;
}

export function ProductivityHeatmap({ weeks = 8, userId }: Props) {
  const { data: days = [], isLoading } = useHeatmap({ weeks, userId });
  if (isLoading) return <Card><CardContent className="py-8 text-center text-slate-400 text-sm">Loading heatmap...</CardContent></Card>;
  if (!days.length) return <Card><CardContent className="py-8 text-center text-slate-400 text-sm">No heatmap data available.</CardContent></Card>;

  const weekGroups = groupIntoWeeks(days);

  return (
    <Card>
      <CardHeader><CardTitle>Productivity Heatmap</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1 items-start min-w-max">
            <div className="flex flex-col gap-1 mr-1 pt-5">
              {DOW_LABELS.map((dow) => (
                <div key={dow} className="h-[14px] text-[9px] text-slate-400 text-right leading-none flex items-center justify-end">{dow}</div>
              ))}
            </div>
            {weekGroups.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-1">
                <div className="h-4 text-[9px] text-slate-400 leading-none text-center">{getMonthLabel(week) ?? ''}</div>
                {week.map((day) => (
                  <div key={day.date} className="w-[14px] h-[14px] rounded-[2px] cursor-default transition-opacity hover:opacity-80"
                    style={{ backgroundColor: LEVEL_COLORS[day.level] }} title={formatTooltip(day)} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <span className="text-xs text-slate-400 mr-1">Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div key={level} className="w-[14px] h-[14px] rounded-[2px] cursor-default"
              style={{ backgroundColor: LEVEL_COLORS[level] }} title={LEVEL_LABELS[level]} />
          ))}
          <span className="text-xs text-slate-400 ml-1">More</span>
        </div>
      </CardContent>
    </Card>
  );
}
