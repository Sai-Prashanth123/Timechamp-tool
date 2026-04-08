'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  usePayrollReport,
  downloadPayrollCsv,
  formatMinutes,
} from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function getMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PayrollReportsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const token = (session as any)?.accessToken as string | undefined;

  const [from, setFrom] = useState(getMonthStart());
  const [to, setTo] = useState(todayISO());

  const { data: rows = [], isLoading, refetch } = usePayrollReport({ from, to });

  const totalHours = rows.reduce((sum, r) => sum + r.totalMinutes / 60, 0);
  const totalOvertime = rows.reduce((sum, r) => sum + r.overtimeMinutes / 60, 0);

  if (!isAdmin) {
    return (
      <>
        <Header title="Payroll Reports" />
        <div className="p-6 text-slate-500 text-sm">Access restricted to admins.</div>
      </>
    );
  }

  return (
    <>
      <Header title="Payroll Reports" />
      <div className="flex-1 p-6 space-y-4 max-w-6xl">
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">From</label>
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">To</label>
                <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <Button onClick={() => refetch()} disabled={isLoading}>{isLoading ? 'Loading...' : 'Run Report'}</Button>
              {rows.length > 0 && token && (
                <Button variant="outline" onClick={() => downloadPayrollCsv(from, to, token)}>Export CSV</Button>
              )}
            </div>
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Employees</p>
              <p className="text-2xl font-bold text-slate-900">{new Set(rows.map((r) => r.userId)).size}</p>
            </div>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Total Hours</p>
              <p className="text-2xl font-bold text-slate-900">{totalHours.toFixed(1)}h</p>
            </div>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Overtime Hours</p>
              <p className="text-2xl font-bold text-amber-600">{totalOvertime.toFixed(1)}h</p>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {isLoading ? 'Loading...' : rows.length === 0 ? 'No approved timesheets in this period' : `${rows.length} approved timesheet${rows.length !== 1 ? 's' : ''}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Week</th>
                      <th className="pb-2 pr-4">Total Hours</th>
                      <th className="pb-2 pr-4">Regular</th>
                      <th className="pb-2">Overtime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, i) => {
                      const regularMinutes = row.totalMinutes - row.overtimeMinutes;
                      return (
                        <tr key={`${row.userId}-${row.weekStart}-${i}`}>
                          <td className="py-2.5 pr-4 font-medium text-slate-800">{row.firstName} {row.lastName}</td>
                          <td className="py-2.5 pr-4 text-slate-600">{row.weekStart}</td>
                          <td className="py-2.5 pr-4 text-slate-700 font-medium">{formatMinutes(row.totalMinutes)}</td>
                          <td className="py-2.5 pr-4 text-slate-600">{formatMinutes(regularMinutes)}</td>
                          <td className="py-2.5">
                            {row.overtimeMinutes > 0 ? (
                              <span className="text-amber-600 font-medium">{formatMinutes(row.overtimeMinutes)}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
