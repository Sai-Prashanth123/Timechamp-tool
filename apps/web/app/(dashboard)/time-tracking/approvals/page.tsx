'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  useTeamTimesheets,
  useApproveTimesheet,
  useRejectTimesheet,
  useBulkApproveTimesheets,
  formatMinutes,
} from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ApprovalsPage() {
  const { data: session } = useSession();
  const isManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data: pending = [], isLoading } = useTeamTimesheets({ status: 'submitted' });
  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const bulkApprove = useBulkApproveTimesheets();

  if (!isManager) {
    return (
      <>
        <Header title="Approvals" />
        <div className="p-6 text-slate-500 text-sm">Access restricted to managers and admins.</div>
      </>
    );
  }

  const handleReject = (id: string) => {
    if (!rejectNote.trim()) return;
    reject.mutate({ id, rejectionNote: rejectNote });
    setRejectingId(null);
    setRejectNote('');
  };

  return (
    <>
      <Header title="Timesheet Approvals" />
      <div className="flex-1 p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {isLoading ? '...' : `${pending.length} timesheet${pending.length !== 1 ? 's' : ''} pending approval`}
          </p>
          {pending.length > 0 && (
            <Button size="sm" disabled={bulkApprove.isPending} onClick={() => bulkApprove.mutate(pending.map((ts) => ts.id))}>
              Approve All
            </Button>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>Pending Approvals</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
            ) : pending.length === 0 ? (
              <p className="text-sm text-green-600 font-medium py-4 text-center">All caught up — no timesheets pending approval.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Week</th>
                      <th className="pb-2 pr-4">Total Hours</th>
                      <th className="pb-2 pr-4">Submitted</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pending.map((ts) => (
                      <>
                        <tr key={ts.id}>
                          <td className="py-3 pr-4 font-medium text-slate-800">{ts.user.firstName} {ts.user.lastName}</td>
                          <td className="py-3 pr-4 text-slate-600">{ts.weekStart}</td>
                          <td className="py-3 pr-4 text-slate-600">{formatMinutes(ts.totalMinutes)}</td>
                          <td className="py-3 pr-4 text-slate-500 text-xs">
                            {ts.submittedAt ? new Date(ts.submittedAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-3">
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" disabled={approve.isPending} onClick={() => approve.mutate(ts.id)}>Approve</Button>
                              <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => { setRejectingId(ts.id); setRejectNote(''); }}>Reject</Button>
                            </div>
                          </td>
                        </tr>
                        {rejectingId === ts.id && (
                          <tr key={`${ts.id}-reject`}>
                            <td colSpan={5} className="pb-3">
                              <div className="flex gap-2 items-center pl-1">
                                <input autoFocus type="text" placeholder="Rejection reason (required)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />
                                <Button size="sm" variant="destructive" disabled={!rejectNote.trim() || reject.isPending} onClick={() => handleReject(ts.id)}>Confirm</Button>
                                <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>Cancel</Button>
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
      </div>
    </>
  );
}
