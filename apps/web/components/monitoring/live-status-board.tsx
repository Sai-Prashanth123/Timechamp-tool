'use client';

import { useEffect } from 'react';
import { useLiveStatus, elapsedSince, type LiveDevice } from '@/hooks/use-monitoring';
import { useMonitoringStore, EmployeeStatus } from '@/stores/monitoring-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Stable empty array — prevents a fresh [] on every render which would
// re-trigger the seeding useEffect in an infinite loop.
const EMPTY_DEVICES: LiveDevice[] = [];

// Defensive against both an undefined/null name and an older API shape
// that might not yet include `userName`/`displayName` (during a staggered
// API+web deploy, the web container can come up first).
function initials(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  return parts.map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2) || '?';
}

function StatusBadge({ status }: { status: EmployeeStatus['status'] }) {
  const colours: Record<EmployeeStatus['status'], string> = {
    online: 'bg-green-400',
    idle: 'bg-yellow-400',
    offline: 'bg-slate-300',
  };
  return <span className={`h-2 w-2 rounded-full shrink-0 ${colours[status]}`} />;
}

/**
 * Device-centric live board. One card per active agent device, counting
 * each separately — a single user with 2 laptops shows as "Live — 2 online"
 * with both machines listed. Presence reads from the REST /monitoring/live
 * feed (refreshed every 30s); the Zustand store is also seeded for the
 * user-centric consumers (/live, /monitoring/[userId]) but we don't route
 * this board's rendering through it to avoid the userId-key collapse.
 */
export function LiveStatusBoard() {
  const { data: devices = EMPTY_DEVICES } = useLiveStatus();

  // Per-user WebSocket presence from the store. Multiple devices that
  // share a userId all inherit the same store status, which is fine —
  // a single user is "online" or "offline" as a coarse overlay; the
  // per-device `lastSeenAt` freshness is what actually matters.
  const storeEmployees = useMonitoringStore((s) => s.employees);
  const _setStatus = useMonitoringStore((s) => s._setStatus);
  const _seedNames = useMonitoringStore((s) => s._seedNames);

  // Seed store so the OTHER pages (/live, /monitoring/[userId]) have
  // presence + names to render, regardless of whether the user visits
  // those pages before /monitoring. Re-runs when the device list changes.
  useEffect(() => {
    if (devices.length === 0) return;
    // Collapse to one entry per user for the user-centric store. Devices
    // without a userId (shouldn't happen but be defensive) are skipped.
    const bySeen = new Map<string, LiveDevice>();
    for (const d of devices) {
      if (!d?.userId) continue;
      const prev = bySeen.get(d.userId);
      if (!prev || (d.lastSeenAt ?? '') > (prev.lastSeenAt ?? '')) {
        bySeen.set(d.userId, d);
      }
    }
    _seedNames(
      Array.from(bySeen.values()).map((d) => {
        const raw = ((d.userName ?? '') || d.userId || '').trim();
        const [firstName = '', ...rest] = raw.split(/\s+/);
        return {
          userId: d.userId,
          firstName,
          lastName: rest.join(' '),
        };
      }),
    );
    for (const d of Array.from(bySeen.values())) {
      _setStatus({
        userId: d.userId,
        status: 'online',
        activeApp: d.currentApp ?? null,
        lastSeen: d.lastSeenAt ?? d.clockedInSince ?? new Date().toISOString(),
      });
    }
    // _setStatus / _seedNames are stable Zustand actions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  const onlineCount = devices.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live — {onlineCount} online
        </CardTitle>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No agents currently online.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {devices.map((d, idx) => {
              // All fields defaulted so a stale API shape (no displayName /
              // hostname / userName) still renders as a harmless placeholder
              // instead of crashing. Key falls back to idx if the API forgot
              // to send deviceId.
              const cardTitle =
                d?.displayName ?? d?.hostname ?? d?.userName ?? 'Unknown device';
              const subLine = d?.userName ?? 'Unknown user';
              const appLabel = d?.currentApp ?? 'Idle';
              const elapsed = d?.lastSeenAt ? elapsedSince(d.lastSeenAt) : '—';
              const userStatus: EmployeeStatus['status'] =
                (d?.userId ? storeEmployees[d.userId]?.status : undefined) ?? 'online';
              const href = d?.userId ? `/monitoring/${d.userId}` : '#';
              return (
                <a
                  key={d?.deviceId ?? `device-${idx}`}
                  href={href}
                  className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                    {initials(cardTitle)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {cardTitle}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {subLine} · {appLabel} · {elapsed}
                    </p>
                  </div>
                  <StatusBadge status={userStatus} />
                </a>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
