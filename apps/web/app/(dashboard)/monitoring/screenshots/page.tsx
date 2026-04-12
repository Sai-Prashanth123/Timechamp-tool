'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { todayISO } from '@/hooks/use-monitoring';
import { useAgentDevices } from '@/hooks/use-agent';

// Suspense wrapper — required because the inner component calls
// `useSearchParams()` at a statically-generated route. Without this the
// Next.js build fails during static export.
export default function ScreenshotsPage() {
  return (
    <Suspense fallback={null}>
      <ScreenshotsPageInner />
    </Suspense>
  );
}

function ScreenshotsPageInner() {
  const searchParams = useSearchParams();
  const urlDeviceId = searchParams.get('deviceId');

  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState('');
  const [deviceId, setDeviceId] = useState<string>('');

  // Seed from URL on first mount so a deep-link from the settings page
  // lands on the right device immediately.
  useEffect(() => {
    if (urlDeviceId) setDeviceId(urlDeviceId);
  }, [urlDeviceId]);

  const { data: devices = [] } = useAgentDevices();

  // If an employee filter is set, only show that user's devices in the
  // dropdown — otherwise show every device in the org.
  const dropdownDevices = useMemo(
    () => (employeeId ? devices.filter((d) => d.userId === employeeId) : devices),
    [devices, employeeId],
  );

  const from = `${selectedDate}T00:00:00.000Z`;
  const to = `${selectedDate}T23:59:59.999Z`;

  return (
    <>
      <Header title="Screenshots" />
      <div className="flex-1 p-6 space-y-6 max-w-7xl">
        <div className="flex flex-wrap gap-3 items-center rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Employee ID</label>
            <input
              type="text"
              placeholder="All employees"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value.trim())}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Device</label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">All devices</option>
              {dropdownDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName ?? d.hostname ?? d.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          {(employeeId || deviceId) && (
            <button
              onClick={() => {
                setEmployeeId('');
                setDeviceId('');
              }}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <ScreenshotGallery
          userId={employeeId || undefined}
          deviceId={deviceId || undefined}
          from={from}
          to={to}
        />
      </div>
    </>
  );
}
