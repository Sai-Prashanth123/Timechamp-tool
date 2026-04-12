'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { ActivityTimeline } from '@/components/monitoring/activity-timeline';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { useMonitoringStore } from '@/stores/monitoring-store';
import { todayISO, elapsedSince } from '@/hooks/use-monitoring';
import { useAgentDevices } from '@/hooks/use-agent';
import api from '@/lib/api';

type Tab = 'live' | 'screenshots' | 'activity';

export default function EmployeeMonitoringPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDeviceId = searchParams.get('deviceId');
  const userId = params.userId as string;

  // Seed the tab to Activity when the deep-link comes in from the settings
  // page — that's the only URL form that uses ?deviceId. For a plain visit
  // to /monitoring/:userId we leave it on 'live'.
  const [tab, setTab] = useState<Tab>(urlDeviceId ? 'activity' : 'live');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(urlDeviceId ?? '');
  const [isRequesting, setIsRequesting] = useState(false);

  // Keep state in sync if the user navigates between devices from the
  // settings page without a full page reload.
  useEffect(() => {
    if (urlDeviceId && urlDeviceId !== selectedDeviceId) {
      setSelectedDeviceId(urlDeviceId);
    }
    // intentional: we only want to react to URL changes, not local state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDeviceId]);

  // Narrow the device picker to just this employee's machines. If they own
  // only one, the picker effectively becomes a read-only label.
  const { data: allDevices = [] } = useAgentDevices();
  const userDevices = useMemo(
    () => allDevices.filter((d) => d.userId === userId),
    [allDevices, userId],
  );

  const handleWatchLive = async () => {
    setIsRequesting(true);
    try {
      await api.post(`/streaming/request/${userId}`);
      router.push(`/live?focus=${userId}`);
    } catch {
      // Agent offline — navigate anyway to show offline state
      router.push(`/live?focus=${userId}`);
    } finally {
      setIsRequesting(false);
    }
  };

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
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <label className="text-sm font-medium text-slate-700 ml-2">Device</label>
            <select
              aria-label="Filter by device"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">All devices ({userDevices.length})</option>
              {userDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName ?? d.hostname ?? d.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'live' && (
          <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Current Status</h3>
              <button
                onClick={handleWatchLive}
                disabled={isRequesting}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isRequesting ? 'Connecting...' : '▶ Watch Live'}
              </button>
            </div>
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
          <ScreenshotGallery
            userId={userId}
            deviceId={selectedDeviceId || undefined}
            from={from}
            to={to}
          />
        )}

        {tab === 'activity' && (
          <ActivityTimeline
            userId={userId}
            deviceId={selectedDeviceId || undefined}
            from={from}
            to={to}
          />
        )}
      </div>
    </>
  );
}
