'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { LiveStatusBoard } from '@/components/monitoring/live-status-board';
import { ActivityTimeline } from '@/components/monitoring/activity-timeline';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { todayISO } from '@/hooks/use-monitoring';

export default function MonitoringPage() {
  const { data: session, status } = useSession();
  const isManager =
    (session?.user?.role === 'admin' || session?.user?.role === 'manager');

  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  const [selectedDate, setSelectedDate] = useState(todayISO());

  useEffect(() => {
    if (status === 'authenticated' && !isManager && session?.user?.id) {
      setSelectedUserId(session.user.id);
    }
  }, [status, isManager, session?.user?.id]);

  if (status === 'loading') {
    return (
      <>
        <Header title="Monitoring" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  const from = `${selectedDate}T00:00:00.000Z`;
  const to = `${selectedDate}T23:59:59.999Z`;

  return (
    <>
      <Header title="Monitoring" />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Live Status — managers only */}
        {isManager && <LiveStatusBoard />}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium text-slate-700">Date</label>
          <input
            type="date"
            aria-label="Select date"
            value={selectedDate}
            max={todayISO()}
            onChange={(e) => setSelectedDate(e.target.value)}
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
        </div>

        {/* Activity + Screenshots */}
        <ActivityTimeline userId={selectedUserId} from={from} to={to} />
        <ScreenshotGallery userId={selectedUserId} from={from} to={to} />
      </div>
    </>
  );
}
