'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { ProductivityChart } from '@/components/analytics/productivity-chart';
import { AppUsageChart } from '@/components/analytics/app-usage-chart';
import { useExportCSV, todayISO, daysAgoISO } from '@/hooks/use-analytics';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [from, setFrom] = useState(daysAgoISO(6)); // last 7 days
  const [to, setTo] = useState(todayISO());
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);

  // For employees, lock to their own userId once session loads
  useEffect(() => {
    if (status === 'authenticated' && !isManager && session?.user?.id) {
      setSelectedUserId(session.user.id);
    }
  }, [status, isManager, session?.user?.id]);

  const exportCSV = useExportCSV();

  if (status === 'loading') {
    return (
      <>
        <Header title="Analytics" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  return (
    <>
      <Header title="Analytics" />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium text-slate-700">From</label>
          <input
            type="date"
            aria-label="Start date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          <label className="text-sm font-medium text-slate-700">To</label>
          <input
            type="date"
            aria-label="End date"
            value={to}
            min={from}
            max={todayISO()}
            onChange={(e) => setTo(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          {isManager && (
            <>
              <label className="text-sm font-medium text-slate-700 ml-2">
                Employee ID (optional)
              </label>
              <input
                type="text"
                aria-label="Filter by employee UUID"
                placeholder="all employees"
                value={selectedUserId ?? ''}
                onChange={(e) =>
                  setSelectedUserId(e.target.value.trim() || undefined)
                }
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            className="ml-auto flex items-center gap-2"
            disabled={exportCSV.isPending}
            onClick={() =>
              exportCSV.mutate({ from, to, userId: selectedUserId })
            }
          >
            <Download className="h-4 w-4" />
            {exportCSV.isPending ? 'Exporting\u2026' : 'Export CSV'}
          </Button>
        </div>

        {/* Charts */}
        <ProductivityChart from={from} to={to} userId={selectedUserId} />
        <AppUsageChart from={from} to={to} userId={selectedUserId} />
      </div>
    </>
  );
}
