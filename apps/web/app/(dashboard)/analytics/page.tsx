'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { ProductivityStackedChart } from '@/components/analytics/productivity-stacked-chart';
import { CategoryDonut } from '@/components/analytics/category-donut';
import { ProductivityHeatmap } from '@/components/analytics/productivity-heatmap';
import { TeamProductivityTable } from '@/components/analytics/team-productivity-table';
import { useExportCSV, last7Days, last30Days, thisWeek, lastWeek, todayISO } from '@/hooks/use-analytics';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

type PresetKey = '7d' | '30d' | 'thisWeek' | 'lastWeek' | 'custom';

interface DateRange {
  from: string;
  to: string;
}

function getPresetRange(preset: PresetKey): DateRange {
  switch (preset) {
    case '7d': return last7Days();
    case '30d': return last30Days();
    case 'thisWeek': return thisWeek();
    case 'lastWeek': return lastWeek();
    default: return last7Days();
  }
}

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [preset, setPreset] = useState<PresetKey>('7d');
  const [customFrom, setCustomFrom] = useState(last7Days().from);
  const [customTo, setCustomTo] = useState(todayISO());

  const range: DateRange =
    preset === 'custom'
      ? { from: customFrom, to: customTo }
      : getPresetRange(preset);

  const userId = isManager ? undefined : (session?.user?.id ?? undefined);

  const exportCSV = useExportCSV();

  const handlePreset = useCallback((key: PresetKey) => {
    setPreset(key);
  }, []);

  if (status === 'loading') {
    return (
      <>
        <Header title="Analytics" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  const presets: { key: PresetKey; label: string }[] = [
    { key: '7d', label: 'Last 7 Days' },
    { key: '30d', label: 'Last 30 Days' },
    { key: 'thisWeek', label: 'This Week' },
    { key: 'lastWeek', label: 'Last Week' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <>
      <Header title="Analytics" />

      <div className="p-6 space-y-6 max-w-7xl">

        {/* ── Date Range Controls ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-slate-200 overflow-hidden">
            {presets.map((p) => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                className={[
                  'px-3 py-1.5 text-sm transition-colors border-r border-slate-200 last:border-r-0',
                  preset === p.key
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Custom start date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                aria-label="Custom end date"
                value={customTo}
                min={customFrom}
                max={todayISO()}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="ml-auto flex items-center gap-2"
            disabled={exportCSV.isPending}
            onClick={() => exportCSV.mutate({ from: range.from, to: range.to, userId })}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exportCSV.isPending ? 'Exporting\u2026' : 'Export CSV'}
          </Button>
        </div>

        {/* ── My Productivity Section ─────────────────────────────────── */}
        <section aria-labelledby="productivity-heading">
          <h2
            id="productivity-heading"
            className="text-base font-semibold text-slate-800 mb-3"
          >
            {isManager ? 'Org Productivity' : 'My Productivity'}
          </h2>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3">
              <ProductivityStackedChart from={range.from} to={range.to} userId={userId} />
            </div>
            <div className="xl:col-span-2">
              <CategoryDonut from={range.from} to={range.to} userId={userId} />
            </div>
          </div>
        </section>

        {/* ── Heatmap Section ─────────────────────────────────────────── */}
        <section aria-labelledby="heatmap-heading">
          <h2 id="heatmap-heading" className="text-base font-semibold text-slate-800 mb-3">
            Activity Heatmap
          </h2>
          <ProductivityHeatmap weeks={8} userId={userId} />
        </section>

        {/* ── Team Overview (managers/admins only) ─────────────────────── */}
        {isManager && (
          <section aria-labelledby="team-overview-heading">
            <h2 id="team-overview-heading" className="text-base font-semibold text-slate-800 mb-3">
              Team Overview
            </h2>
            <TeamProductivityTable from={range.from} to={range.to} />
          </section>
        )}

      </div>
    </>
  );
}
