'use client';

import { useState } from 'react';
import { useGpsLocations, type GpsLocation } from '@/hooks/use-gps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function formatCoord(val: number | string, decimals = 6): string {
  return Number(val).toFixed(decimals);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function LocationHistory({ userId }: { userId?: string }) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todayStart = `${todayStr}T00:00:00Z`;
  const todayEnd = `${todayStr}T23:59:59Z`;

  const [from, setFrom] = useState(todayStart);
  const [to, setTo] = useState(todayEnd);
  const [appliedFrom, setAppliedFrom] = useState(todayStart);
  const [appliedTo, setAppliedTo] = useState(todayEnd);
  const [sortAsc, setSortAsc] = useState(false);

  const { data: locations = [], isLoading, isFetching } = useGpsLocations({
    from: appliedFrom,
    to: appliedTo,
    userId,
  });

  const sorted = [...locations].sort((a, b) => {
    const diff = new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime();
    return sortAsc ? diff : -diff;
  });

  function applyFilter() {
    setAppliedFrom(from);
    setAppliedTo(to);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Location History</CardTitle>
      </CardHeader>

      {/* Date filter bar */}
      <CardContent className="border-b pb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="loc-from" className="text-xs">From</Label>
            <Input
              id="loc-from"
              type="datetime-local"
              value={from.slice(0, 16)}
              onChange={(e) => setFrom(e.target.value ? `${e.target.value}:00Z` : from)}
              className="h-8 text-sm w-48"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="loc-to" className="text-xs">To</Label>
            <Input
              id="loc-to"
              type="datetime-local"
              value={to.slice(0, 16)}
              onChange={(e) => setTo(e.target.value ? `${e.target.value}:59Z` : to)}
              className="h-8 text-sm w-48"
            />
          </div>
          <Button size="sm" onClick={applyFilter} disabled={isFetching}>
            {isFetching ? 'Loading...' : 'Apply'}
          </Button>
        </div>
      </CardContent>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-slate-400">Loading locations...</div>
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            No location data for the selected period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th
                    className="text-left px-4 py-2 font-medium text-slate-600 cursor-pointer select-none whitespace-nowrap"
                    onClick={() => setSortAsc((v) => !v)}
                  >
                    Time {sortAsc ? '\u2191' : '\u2193'}
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Latitude</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Longitude</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Accuracy (m)</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Battery (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((loc: GpsLocation) => (
                  <tr key={loc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">
                      {formatDateTime(loc.recordedAt)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600">
                      {formatCoord(loc.lat)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600">
                      {formatCoord(loc.lng)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      {loc.accuracy !== null ? Number(loc.accuracy).toFixed(1) : '\u2014'}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      {loc.batteryLevel !== null ? `${loc.batteryLevel}%` : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 px-4 py-2 border-t">
              {sorted.length} point{sorted.length !== 1 ? 's' : ''} -- capped at 1,000 per query
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
