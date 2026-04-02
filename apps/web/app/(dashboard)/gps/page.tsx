'use client';

import { useSession } from 'next-auth/react';
import { useGpsLive, type GpsLocation } from '@/hooks/use-gps';
import { LocationHistory } from '@/components/gps/location-history';
import { GeofenceManager } from '@/components/gps/geofence-manager';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function LiveLocationsTable() {
  const { data: locations = [], isLoading } = useGpsLive();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-400">
          Loading live locations...
        </CardContent>
      </Card>
    );
  }

  if (locations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Employee Locations</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-slate-400">
          No live location data available. Locations appear once the agent begins syncing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Employee Locations</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">User ID</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Latitude</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Longitude</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Battery (%)</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {locations.map((loc: GpsLocation) => (
                <tr key={loc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-slate-600 truncate max-w-[12rem]">
                    {loc.userId}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600">
                    {Number(loc.lat).toFixed(6)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600">
                    {Number(loc.lng).toFixed(6)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {loc.batteryLevel !== null ? `${loc.batteryLevel}%` : '\u2014'}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500 whitespace-nowrap">
                    {formatDateTime(loc.recordedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GpsPage() {
  const { data: session } = useSession();
  const isManagerOrAdmin =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  return (
    <>
      <Header title="GPS & Field" />
      <div className="p-6 space-y-6 max-w-6xl">
        {/* Live overview -- managers/admins only */}
        {isManagerOrAdmin && <LiveLocationsTable />}

        {/* Personal location history -- all roles */}
        <LocationHistory userId={isManagerOrAdmin ? undefined : session?.user?.id} />

        {/* Geofence management -- managers/admins only */}
        {isManagerOrAdmin && <GeofenceManager />}
      </div>
    </>
  );
}
