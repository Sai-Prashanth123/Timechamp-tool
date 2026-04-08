'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useCategoryBreakdown, CategoryBreakdownSlice } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props { from: string; to: string; userId?: string }
interface TooltipPayload { name: string; value: number; payload: CategoryBreakdownSlice }
interface CustomTooltipProps { active?: boolean; payload?: TooltipPayload[] }

const CATEGORY_COLORS: Record<string, string> = { productive: '#22c55e', unproductive: '#ef4444', neutral: '#94a3b8' };
const CATEGORY_LABELS: Record<string, string> = { productive: 'Productive', unproductive: 'Unproductive', neutral: 'Neutral' };

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md p-3 text-sm">
      <p className="font-semibold capitalize" style={{ color: CATEGORY_COLORS[slice.category] }}>{CATEGORY_LABELS[slice.category]}</p>
      <p className="text-slate-600 mt-0.5">{slice.minutes >= 60 ? `${Math.floor(slice.minutes / 60)}h ${slice.minutes % 60}m` : `${slice.minutes}m`} ({slice.percent}%)</p>
    </div>
  );
}

function CenterLabel({ viewBox, productivePercent }: { viewBox?: { cx?: number; cy?: number }; productivePercent: number }) {
  const { cx = 0, cy = 0 } = viewBox ?? {};
  return (
    <g>
      <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 22, fontWeight: 700, fill: '#1e293b' }}>{productivePercent}%</text>
      <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fill: '#64748b' }}>Productive</text>
    </g>
  );
}

export function CategoryDonut({ from, to, userId }: Props) {
  const { data: slices = [], isLoading } = useCategoryBreakdown({ from, to, userId });
  if (isLoading) return <Card><CardContent className="py-8 text-center text-slate-400 text-sm">Loading breakdown...</CardContent></Card>;
  const productivePercent = slices.find((s) => s.category === 'productive')?.percent ?? 0;

  return (
    <Card>
      <CardHeader><CardTitle>Category Breakdown</CardTitle></CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">No activity recorded for this period.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={slices} dataKey="percent" nameKey="category" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} strokeWidth={0}
                  label={<CenterLabel productivePercent={productivePercent} />} labelLine={false}>
                  {slices.map((slice) => <Cell key={slice.category} fill={CATEGORY_COLORS[slice.category]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2 flex-wrap">
              {slices.map((slice) => (
                <div key={slice.category} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[slice.category] }} />
                  <span className="capitalize">{CATEGORY_LABELS[slice.category]}</span>
                  <span className="text-slate-400">{slice.minutes >= 60 ? `${Math.floor(slice.minutes / 60)}h ${slice.minutes % 60}m` : `${slice.minutes}m`} ({slice.percent}%)</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
