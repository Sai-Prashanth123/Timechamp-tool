'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { ActivityTimeline } from '@/components/monitoring/activity-timeline';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { useMonitoringStore } from '@/stores/monitoring-store';
import { todayISO, elapsedSince } from '@/hooks/use-monitoring';

type Tab = 'live' | 'screenshots' | 'activity';

export default function EmployeeMonitoringPage() {
  const params = useParams();
  const userId = params.userId as string;

  const [tab, setTab] = useState<Tab>('live');
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const employee = useMonitoringStore((s) => s.employees[userId]);
  const names = useMonitoringStore((s) => s.employeeNames[userId]);
  const displayName = names
    ? `${names.firstName} ${names.lastName}`.trim()
    : userId;

  const from = `${selectedDate}T00:00:00.000Z`;
  const to = `${selectedDate}T23:59:59.999Z`;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'screenshots', label: 'Screenshots' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <>
      <Header title={`Monitoring — ${displayName}`} />

      <div className="flex-1 p-6 space-y-6 max-w-5xl">
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'live' && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        )}

        {tab === 'live' && (
          <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Current Status</h3>
            {employee ? (
              <div className="flex items-center gap-4">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    employee.status === 'online'
                      ? 'bg-green-400'
                      : employee.status === 'idle'
                      ? 'bg-yellow-400'
                      : 'bg-slate-300'
                  }`}
                />
                <div>
                  <p className="text-sm font-medium text-slate-800 capitalize">
                    {employee.status}
                  </p>
                  <p className="text-xs text-slate-500">
                    Active app: {employee.activeApp ?? 'None'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Last seen {elapsedSince(employee.lastSeen)} ago
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                No live data yet. Waiting for agent heartbeat...
              </p>
            )}
          </div>
        )}

        {tab === 'screenshots' && (
          <ScreenshotGallery userId={userId} from={from} to={to} />
        )}

        {tab === 'activity' && (
          <ActivityTimeline userId={userId} from={from} to={to} />
        )}
      </div>
    </>
  );
}
