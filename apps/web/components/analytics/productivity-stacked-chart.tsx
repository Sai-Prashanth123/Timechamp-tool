'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useProductivityReport } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props { from: string; to: string; userId?: string }
interface ChartRow { date: string; label: string; productive: number; unproductive: number; neutral: number }
interface TooltipPayload { color: string; name: string; value: number }
interface CustomTooltipProps { active?: boolean; payload?: TooltipPayload[]; label?: string }

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md p-3 text-sm">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
          <span className="text-slate-600 capitalize">{p.name}:</span>
          <span className="font-medium">{p.value >= 60 ? `${Math.floor(p.value / 60)}h ${p.value % 60}m` : `${p.value}m`}</span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t border-slate-100 text-slate-500">
        Total: {total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`}
      </div>
    </div>
  );
}

export function ProductivityStackedChart({ from, to, userId }: Props) {
  const { data: days = [], isLoading } = useProductivityReport({ from, to, userId });

  if (isLoading) return (
    <Card><CardContent className="py-8 text-center text-slate-400 text-sm">Loading productivity data...</CardContent></Card>
  );

  const chartData: ChartRow[] = days.map((d) => ({
    date: d.date, label: formatDateLabel(d.date),
    productive: d.productiveMinutes, unproductive: d.unproductiveMinutes, neutral: d.neutralMinutes,
  }));
  const hasData = chartData.some((r) => r.productive + r.unproductive + r.neutral > 0);

  return (
    <Card>
      <CardHeader><CardTitle>Daily Activity Breakdown</CardTitle></CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-center text-slate-400 text-sm py-8">No activity recorded for this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v: number) => v >= 60 ? `${Math.floor(v / 60)}h` : `${v}m`} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} formatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)} />
              <Bar dataKey="productive" stackId="a" fill="#22c55e" name="productive" radius={[0, 0, 0, 0]} />
              <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="neutral" radius={[0, 0, 0, 0]} />
              <Bar dataKey="unproductive" stackId="a" fill="#ef4444" name="unproductive" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
