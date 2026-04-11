'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLiveStatus, elapsedSince } from '@/hooks/use-monitoring'
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

export function LivePageClient({ token: _token }: { token: string }) {
  const searchParams = useSearchParams()
  const focusUserId = searchParams.get('focus')

  // Presence: REST seed + WebSocket live updates via the monitoring gateway.
  // Every employee with an active agent appears here regardless of whether
  // their live view is currently being watched.
  const { data: seedEmployees } = useLiveStatus()
  useMonitoringSocket()
  const storeEmployees = useMonitoringStore((s) => s.employees)
  const storeNames = useMonitoringStore((s) => s.employeeNames)
  const _setStatus = useMonitoringStore((s) => s._setStatus)
  const _seedNames = useMonitoringStore((s) => s._seedNames)

  // Seed the store from the REST response on first load so the page renders
  // something immediately, even before the first WS event arrives.
  useEffect(() => {
    if (!seedEmployees) return
    _seedNames(
      seedEmployees.map((e) => ({
        userId: e.userId,
        firstName: e.firstName ?? e.userId,
        lastName: e.lastName ?? '',
      })),
    )
    for (const emp of seedEmployees) {
      _setStatus({
        userId: emp.userId,
        status: 'online',
        activeApp: emp.currentApp ?? null,
        lastSeen: emp.lastSeenAt ?? emp.clockedInSince ?? new Date().toISOString(),
      })
    }
  }, [seedEmployees, _seedNames, _setStatus])

  // Live-view overlay state. When set, opens a fullscreen covert live view.
  // The view polls the screenshot burst-mode pipeline; the agent captures at
  // 1 FPS while watched and reverts to its normal interval when closed.
  const [watchedUserId, setWatchedUserId] = useState<string | null>(null)

  // Auto-open live view if navigated with ?focus=<userId>
  useEffect(() => {
    if (focusUserId) setWatchedUserId(focusUserId)
  }, [focusUserId])

  const employees = useMemo(() => {
    return Object.values(storeEmployees).sort((a, b) => {
      const order = { online: 0, idle: 1, offline: 2 }
      const diff = order[a.status] - order[b.status]
      if (diff !== 0) return diff
      return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    })
  }, [storeEmployees])

  const onlineCount = employees.filter((e) => e.status !== 'offline').length

  const handleWatch = (userId: string) => {
    setWatchedUserId(userId)
  }

  const handleCloseWatch = () => {
    setWatchedUserId(null)
  }

  const watchedName = watchedUserId
    ? (() => {
        const n = storeNames[watchedUserId]
        return n ? `${n.firstName} ${n.lastName}`.trim() || watchedUserId : watchedUserId
      })()
    : ''

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Live Monitoring</h1>
        <span className="text-zinc-400 text-sm">
          {onlineCount} online
        </span>
      </div>

      {employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
          <p className="text-lg">No employees online</p>
          <p className="text-sm mt-1">Employees will appear here when the agent connects</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
          {employees.map((emp) => {
            const name = storeNames[emp.userId]
            const displayName = name
              ? `${name.firstName} ${name.lastName}`.trim() || emp.userId
              : emp.userId
            const isWatching = watchedUserId === emp.userId
            return (
              <div
                key={emp.userId}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 transition-colors p-4 flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="h-11 w-11 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold">
                      {initials(displayName)}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-zinc-900 ${STATUS_DOT[emp.status]}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{displayName}</p>
                    <p className="text-zinc-400 text-xs truncate">
                      {STATUS_LABEL[emp.status]} · {elapsedSince(emp.lastSeen)} ago
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
                  <span className="truncate flex-1">
                    {emp.activeApp ?? (emp.status === 'idle' ? 'Away' : '—')}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={emp.status === 'offline'}
                  onClick={() => handleWatch(emp.userId)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {isWatching ? 'Watching Live' : 'Watch Live'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {watchedUserId && (
        <LiveScreenshotView
          userId={watchedUserId}
          displayName={watchedName}
          onClose={handleCloseWatch}
        />
      )}
    </div>
  )
}
