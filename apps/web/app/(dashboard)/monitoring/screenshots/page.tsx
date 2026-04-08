'use client';

import { useState } from 'react';
import { Header } from '@/components/dashboard/header';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { todayISO } from '@/hooks/use-monitoring';

export default function ScreenshotsPage() {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState('');

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
          {employeeId && (
            <button
              onClick={() => setEmployeeId('')}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Clear filter
            </button>
          )}
        </div>

        <ScreenshotGallery
          userId={employeeId || undefined}
          from={from}
          to={to}
        />
      </div>
    </>
  );
}
