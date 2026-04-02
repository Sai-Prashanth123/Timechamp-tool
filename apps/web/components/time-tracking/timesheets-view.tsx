'use client';

import {
  useTimesheets,
  useSubmitTimesheet,
  useApproveTimesheet,
  useRejectTimesheet,
  formatMinutes,
  getWeekStart,
} from '@/hooks/use-time-tracking';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export function TimesheetsView() {
  const { data: session } = useSession();
  const { data: timesheets = [], isLoading } = useTimesheets();
  const submit = useSubmitTimesheet();
  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';
  const thisWeek = getWeekStart();

  const handleReject = (id: string) => {
    if (!rejectNote.trim()) return;
    reject.mutate({ id, rejectionNote: rejectNote });
    setRejectingId(null);
    setRejectNote('');
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading timesheets...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Timesheets</CardTitle>
        {!isManager && (
          <Button
            size="sm"
            disabled={submit.isPending}
            onClick={() => submit.mutate(thisWeek)}
          >
            {submit.isPending ? 'Submitting...' : 'Submit This Week'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {timesheets.length === 0 ? (
          <p className="py-8 text-center text-slate-400 text-sm">
            No timesheets yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Week Starting</th>
                  <th className="px-4 py-3">Total Hours</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  {isManager && <th className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {timesheets.map((ts) => (
                  <>
                    <tr
                      key={ts.id}
                      className="border-b last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {new Date(ts.weekStart + 'T00:00:00').toLocaleDateString(
                          undefined,
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {formatMinutes(ts.totalMinutes)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[ts.status] ?? ''}`}
                        >
                          {ts.status}
                        </span>
                        {ts.status === 'rejected' && ts.rejectionNote && (
                          <p className="text-xs text-red-500 mt-0.5 max-w-xs truncate">
                            {ts.rejectionNote}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {ts.submittedAt
                          ? new Date(ts.submittedAt).toLocaleDateString()
                          : '—'}
                      </td>
                      {isManager && (
                        <td className="px-4 py-3">
                          {ts.status === 'submitted' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                disabled={approve.isPending}
                                onClick={() => approve.mutate(ts.id)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => setRejectingId(ts.id)}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {rejectingId === ts.id && (
                      <tr key={`${ts.id}-reject`} className="bg-red-50">
                        <td colSpan={isManager ? 5 : 4} className="px-4 py-3">
                          <div className="flex gap-2 items-center">
                            <input
                              className="flex-1 border border-red-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                              placeholder="Reason for rejection..."
                              value={rejectNote}
                              onChange={(e) => setRejectNote(e.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!rejectNote.trim() || reject.isPending}
                              onClick={() => handleReject(ts.id)}
                            >
                              Confirm Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRejectingId(null);
                                setRejectNote('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
