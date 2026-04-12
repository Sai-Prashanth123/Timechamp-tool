'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLiveStatus, elapsedSince, type LiveDevice } from '@/hooks/use-monitoring'
import { useMonitoringSocket } from '@/hooks/use-monitoring-socket'
import { useMonitoringStore, EmployeeStatus } from '@/stores/monitoring-store'
import { LiveScreenshotView } from '@/components/streaming/live-screenshot-view'

const STATUS_DOT: Record<EmployeeStatus['status'], string> = {
  online: 'bg-green-400 ring-green-400/30',
  idle: 'bg-yellow-400 ring-yellow-400/30',
  offline: 'bg-zinc-500 ring-zinc-500/30',
}

const STATUS_LABEL: Record<EmployeeStatus['status'], string> = {
  online: 'Online',
  idle: 'Idle',
  offline: 'Offline',
}

// Stable empty array — prevents a fresh [] on every render which would
// re-trigger the seeding useEffect in an infinite loop.
const EMPTY_DEVICES: LiveDevice[] = []

function initials(name: string | null | undefined): string {
  const clean = (name ?? '').trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

/**
 * Device-centric live monitoring grid. One card per active agent device —
 * a user with 2 laptops shows up as 2 cards side by side, each with its
 * own "Watch Live" button that flags only that specific machine's agent
 * into burst-capture mode.
 *
 * Presence overlay (the green/yellow/grey dot) is still driven by the
 * user-keyed Zustand store, which is populated via the WebSocket. Multiple
 * devices owned by the same user share that coarse status — fine for a
 * beta where only one machine is actually active at a time.
 */
export function LivePageClient({ token: _token }: { token: string }) {
  const searchParams = useSearchParams()
  const focusDeviceId = searchParams.get('focus')

  const { data: seedDevices = EMPTY_DEVICES } = useLiveStatus()
  useMonitoringSocket()
  const storeEmployees = useMonitoringStore((s) => s.employees)
  const _setStatus = useMonitoringStore((s) => s._setStatus)
  const _seedNames = useMonitoringStore((s) => s._seedNames)

  // Seed the user-keyed store so the per-user presence overlay has
  // something to display before the first WS event. Collapse to one seed
  // entry per user because _setStatus / _seedNames are userId-keyed;
  // rendering below iterates devices directly, not the store.
  useEffect(() => {
    if (seedDevices.length === 0) return
    const byUser = new Map<string, LiveDevice>()
    for (const d of seedDevices) {
      if (!d?.userId) continue
      const prev = byUser.get(d.userId)
      if (!prev || (d.lastSeenAt ?? '') > (prev.lastSeenAt ?? '')) {
        byUser.set(d.userId, d)
      }
    }
    _seedNames(
      Array.from(byUser.values()).map((d) => {
        const raw = ((d.userName ?? '') || d.userId || '').trim()
        const [firstName = '', ...rest] = raw.split(/\s+/)
        return {
          userId: d.userId,
          firstName,
          lastName: rest.join(' '),
        }
      }),
    )
    for (const d of Array.from(byUser.values())) {
      _setStatus({
        userId: d.userId,
        status: 'online',
        activeApp: d.currentApp ?? null,
        lastSeen: d.lastSeenAt ?? d.clockedInSince ?? new Date().toISOString(),
      })
    }
  }, [seedDevices, _seedNames, _setStatus])

  // Which device (if any) is currently being watched in the overlay.
  // Stores the full LiveDevice so the overlay has the displayName + userId
  // without a lookup.
  const [watchedDevice, setWatchedDevice] = useState<LiveDevice | null>(null)

  // Auto-open live view if navigated with ?focus=<deviceId>
  useEffect(() => {
    if (!focusDeviceId || seedDevices.length === 0) return
    const match = seedDevices.find((d) => d.deviceId === focusDeviceId)
    if (match) setWatchedDevice(match)
  }, [focusDeviceId, seedDevices])

  // Sort devices for stable display: online first, then idle, then offline;
  // within a status, most recently seen first. Status is inherited from the
  // user-keyed store — if the store has no entry, we fall back to 'online'
  // since REST only returns devices that are currently active.
  const sortedDevices = useMemo(() => {
    const order: Record<EmployeeStatus['status'], number> = { online: 0, idle: 1, offline: 2 }
    const withStatus = seedDevices.map((d) => ({
      device: d,
      status: storeEmployees[d.userId]?.status ?? 'online',
    }))
    return withStatus.sort((a, b) => {
      const diff = order[a.status] - order[b.status]
      if (diff !== 0) return diff
      const aTs = a.device.lastSeenAt ? new Date(a.device.lastSeenAt).getTime() : 0
      const bTs = b.device.lastSeenAt ? new Date(b.device.lastSeenAt).getTime() : 0
      return bTs - aTs
    })
  }, [seedDevices, storeEmployees])

  const onlineCount = sortedDevices.filter((x) => x.status !== 'offline').length

  const handleWatch = (d: LiveDevice) => {
    setWatchedDevice(d)
  }

  const handleCloseWatch = () => {
    setWatchedDevice(null)
  }

  const watchedCardTitle = watchedDevice
    ? (watchedDevice.displayName ?? watchedDevice.hostname ?? watchedDevice.userName ?? 'Unknown device')
    : ''

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Live Monitoring</h1>
        <span className="text-zinc-400 text-sm">
          {onlineCount} online
        </span>
      </div>

      {sortedDevices.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
          <p className="text-lg">No agents online</p>
          <p className="text-sm mt-1">Devices will appear here when the agent connects</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
          {sortedDevices.map(({ device: d, status }, idx) => {
            const cardTitle = d.displayName ?? d.hostname ?? d.userName ?? 'Unknown device'
            const subLine = d.userName ?? 'Unknown user'
            const isWatching = watchedDevice?.deviceId === d.deviceId
            const appLabel = d.currentApp ?? (status === 'idle' ? 'Away' : '—')
            const elapsed = d.lastSeenAt ? elapsedSince(d.lastSeenAt) : '—'
            return (
              <div
                key={d.deviceId ?? `device-${idx}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 transition-colors p-4 flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="h-11 w-11 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold">
                      {initials(cardTitle)}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-zinc-900 ${STATUS_DOT[status]}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{cardTitle}</p>
                    <p className="text-zinc-400 text-xs truncate">
                      {subLine} · {STATUS_LABEL[status]} · {elapsed} ago
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
                  <span className="truncate flex-1">{appLabel}</span>
                </div>

                <button
                  type="button"
                  disabled={status === 'offline' || !d.deviceId}
                  onClick={() => handleWatch(d)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {isWatching ? 'Watching Live' : 'Watch Live'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {watchedDevice && (
        <LiveScreenshotView
          userId={watchedDevice.userId}
          deviceId={watchedDevice.deviceId}
          displayName={watchedCardTitle}
          onClose={handleCloseWatch}
        />
      )}
    </div>
  )
}
