'use client';

import { Header } from '@/components/dashboard/header';
import { ClockWidget } from '@/components/time-tracking/clock-widget';
import { EntriesTable } from '@/components/time-tracking/entries-table';
import { TimesheetsView } from '@/components/time-tracking/timesheets-view';

export default function TimeTrackingPage() {
  return (
    <>
      <Header title="Time Tracking" />
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <ClockWidget />
          </div>
          <div className="md:col-span-2">
            <TimesheetsView />
          </div>
        </div>
        <EntriesTable />
      </div>
    </>
  );
}
