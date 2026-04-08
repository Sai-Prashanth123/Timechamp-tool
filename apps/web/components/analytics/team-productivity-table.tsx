'use client';

import { useState } from 'react';
import { useProductivitySummary, OrgProductivitySummaryRow } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props { from: string; to: string }
type SortKey = 'name' | 'productivePercent' | 'totalHours' | 'topApp';
type SortDir = 'asc' | 'desc';

function percentColor(pct: number): string {
  if (pct >= 70) return 'text-green-600 bg-green-50';
  if (pct >= 50) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

function TrendIcon({ pct }: { pct: number }) {
  if (pct >= 70) return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (pct >= 50) return <Minus className="h-4 w-4 text-amber-500" />;
  return <TrendingDown className="h-4 w-4 text-red-500" />;
}

export function TeamProductivityTable({ from, to }: Props) {
  const { data: rows = [], isLoading } = useProductivitySummary({ from, to });
  const [sortKey, setSortKey] = useState<SortKey>('productivePercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (col: SortKey) => {
    if (col === sortKey) setSortDir((prev) => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('desc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    else if (sortKey === 'productivePercent') cmp = a.productivePercent - b.productivePercent;
    else if (sortKey === 'totalHours') cmp = a.totalHours - b.totalHours;
    else cmp = a.topApp.localeCompare(b.topApp);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortBtn = ({ col }: { col: SortKey }) => (
    <button onClick={() => handleSort(col)} className="inline-flex items-center gap-1 hover:text-slate-800 ml-1">
      <ArrowUpDown className={`h-3 w-3 ${sortKey === col ? 'text-blue-500' : 'text-slate-300'}`} />
    </button>
  );

  return (
    <Card>
      <CardHeader><CardTitle>Team Productivity Overview</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-slate-400 text-center py-6">Loading team data...</p>
          : rows.length === 0 ? <p className="text-sm text-slate-400 text-center py-6">No activity recorded for this period.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="pb-3 pr-4">Employee<SortBtn col="name" /></th>
                    <th className="pb-3 pr-4">Productive %<SortBtn col="productivePercent" /></th>
                    <th className="pb-3 pr-4">Total Hours<SortBtn col="totalHours" /></th>
                    <th className="pb-3 pr-4">Top App<SortBtn col="topApp" /></th>
                    <th className="pb-3">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sorted.map((row: OrgProductivitySummaryRow) => (
                    <tr key={row.userId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-slate-800">{row.firstName} {row.lastName}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${percentColor(row.productivePercent)}`}>{row.productivePercent}%</span>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{row.totalHours.toFixed(1)}h</td>
                      <td className="py-3 pr-4 text-slate-600 truncate max-w-[160px]" title={row.topApp}>{row.topApp || '—'}</td>
                      <td className="py-3"><TrendIcon pct={row.productivePercent} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
