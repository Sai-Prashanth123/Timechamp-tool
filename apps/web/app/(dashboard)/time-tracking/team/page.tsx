'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  useTeamTimesheets,
  useApproveTimesheet,
  useRejectTimesheet,
  useBulkApproveTimesheets,
  formatMinutes,
  getWeekStart,
} from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function TeamTimesheetsPage() {
  const { data: session } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data: timesheets = [], isLoading } = useTeamTimesheets({ weekStart });
  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const bulkApprove = useBulkApproveTimesheets();

  if (!isManager) {
    return (
      <>
        <Header title="Team Timesheets" />
        <div className="p-6 text-slate-500 text-sm">Access restricted to managers and admins.</div>
      </>
    );
  }

  const submittedIds = timesheets
    .filter((ts) => ts.status === 'submitted')
    .map((ts) => ts.id);

  const handleReject = (id: string) => {
    if (!rejectNote.trim()) return;
    reject.mutate({ id, rejectionNote: rejectNote });
    setRejectingId(null);
    setRejectNote('');
  };

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  return (
    <>
      <Header title="Team Timesheets" />
      <div className="flex-1 p-6 space-y-4 max-w-6xl">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}>&larr; Prev Week</Button>
          <span className="text-sm font-medium text-slate-700">Week of {weekStart}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => shiftWeek(1)}
            disabled={weekStart >= getWeekStart()}
          >
            Next Week &rarr;
          </Button>
          {submittedIds.length > 0 && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={bulkApprove.isPending}
              onClick={() => bulkApprove.mutate(submittedIds)}
            >
              Approve All ({submittedIds.length})
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{timesheets.length} timesheet{timesheets.length !== 1 ? 's' : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
            ) : timesheets.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No timesheets for this week.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Total Hours</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {timesheets.map((ts) => (
                      <React.Fragment key={ts.id}>
                        <tr>
                          <td className="py-3 pr-4 font-medium text-slate-800">
                            {ts.user.firstName} {ts.user.lastName}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{formatMinutes(ts.totalMinutes)}</td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[ts.status] ?? ''}`}>
                              {ts.status}
                            </span>
                          </td>
                          <td className="py-3">
                            {ts.status === 'submitted' && (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" disabled={approve.isPending} onClick={() => approve.mutate(ts.id)}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => { setRejectingId(ts.id); setRejectNote(''); }}>
                                  Reject
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {rejectingId === ts.id && (
                          <tr key={`${ts.id}-reject`}>
                            <td colSpan={4} className="pb-3">
                              <div className="flex gap-2 items-center pl-1">
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Rejection reason (required)"
                                  value={rejectNote}
                                  onChange={(e) => setRejectNote(e.target.value)}
                                  className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                                />
                                <Button size="sm" variant="destructive" disabled={!rejectNote.trim() || reject.isPending} onClick={() => handleReject(ts.id)}>Confirm</Button>
                                <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>Cancel</Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
