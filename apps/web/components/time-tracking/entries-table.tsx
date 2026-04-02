'use client';

import { useTimeEntries, useDeleteEntry, formatMinutes } from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function durationMinutes(start: string, end: string | null): number {
  if (!end) return 0;
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

const sourceColors: Record<string, string> = {
  automatic: 'bg-blue-100 text-blue-700',
  manual: 'bg-yellow-100 text-yellow-700',
  edited: 'bg-purple-100 text-purple-700',
};

export function EntriesTable() {
  const { data: entries = [], isLoading } = useTimeEntries();
  const deleteEntry = useDeleteEntry();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading entries...
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Time Entries</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          No time entries yet. Clock in to start tracking.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time Entries</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const dur = durationMinutes(entry.startedAt, entry.endedAt);
                return (
                  <tr
                    key={entry.id}
                    className="border-b last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-slate-700">
                      {new Date(entry.startedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {new Date(entry.startedAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {entry.endedAt
                        ? new Date(entry.endedAt).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {dur > 0 ? formatMinutes(dur) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${sourceColors[entry.source] ?? ''}`}
                      >
                        {entry.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                      {entry.description ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {entry.source !== 'automatic' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          disabled={deleteEntry.isPending}
                          onClick={() => deleteEntry.mutate(entry.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
