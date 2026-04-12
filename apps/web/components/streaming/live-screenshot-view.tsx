'use client'

import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { useMonitoringSocket } from '@/hooks/use-monitoring-socket'

interface LiveScreenshot {
  id: string
  userId: string
  capturedAt: string
  url: string
}

interface Props {
  userId: string
  /**
   * When set, all /streaming and /monitoring calls are scoped to this
   * specific agent device. When null, fall back to the legacy user-level
   * routes (used by /monitoring/[userId] which is user-centric by design).
   */
  deviceId?: string | null
  displayName: string
  onClose: () => void
}

// How often the browser re-pokes /streaming/request to refresh the 60s Redis TTL.
// 15s gives 4 attempts before the 60s server TTL expires — tolerates three
// consecutive network blips before the live session silently dies.
const KEEPALIVE_INTERVAL_MS = 15_000

// Fallback HTTP poll cadence. The primary frame delivery channel is the
// `employee:screenshot` WebSocket event (which carries the presigned URL
// inline, so the browser can render immediately). The poll is only here
// as a safety net in case the socket drops or a frame is missed —
// polling at the same cadence as the agent's 500ms burst tick would
// burn bandwidth for no gain once the WS is wired.
const FRAME_POLL_INTERVAL_MS = 2_000

/**
 * Fullscreen live-view overlay.
 *
 * Frame delivery is hybrid: the monitoring WebSocket's `employee:screenshot`
 * event is the primary channel — each frame arrives with its presigned URL
 * inline, so we render on arrival with zero extra round-trips. An HTTP poll
 * runs at a slow 2s fallback cadence purely as insurance against WS drops.
 *
 * Covert flow:
 *  1. On mount, POST /streaming/request/device/:id — sets the
 *     LiveWatchCache flag `${userId}:${deviceId}=1` with a 60s TTL.
 *  2. The desktop agent polls GET /agent/sync/commands every 1s. When it sees
 *     liveView=true, it enters burst capture mode (500ms cadence, JPEG q60,
 *     max 1280px). Each capture is uploaded via the regular Supabase pipeline.
 *  3. API saveScreenshot persists the row, then emits `employee:screenshot`
 *     on the /monitoring namespace with the presigned URL in the payload.
 *  4. This component listens for that event, filters by deviceId, and
 *     cross-fades the new frame on top of the previous one so the transition
 *     looks video-like rather than a hard slideshow cut.
 *  5. Browser re-calls /streaming/request/:id every 15s to refresh the TTL.
 *  6. On close, POST /streaming/request/:id/stop clears the flag; the agent's
 *     next 1s command poll sees liveView=false and exits burst mode.
 */
export function LiveScreenshotView({ userId, deviceId, displayName, onClose }: Props) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [prevUrl, setPrevUrl] = useState<string | null>(null)
  const [currentOpacity, setCurrentOpacity] = useState<number>(1)
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastIdRef = useRef<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const startTimeRef = useRef<number>(Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)

  // Make sure the monitoring socket is connected — idempotent if it already
  // is (see useMonitoringSocket + connect guard in the store). This is the
  // same hook /live calls at page level, so in most cases it's a no-op here.
  useMonitoringSocket()
  const socket = useMonitoringStore((s) => s.socket)

  // Device-scoped routes when we know which machine to watch, legacy
  // user-scoped routes when we don't (navigated from /monitoring/[userId]).
  const startRoute = deviceId ? `/streaming/request/device/${deviceId}` : `/streaming/request/${userId}`
  const stopRoute = deviceId ? `/streaming/request/device/${deviceId}/stop` : `/streaming/request/${userId}/stop`

  // Shared frame-update logic — used by both the WS handler and the HTTP
  // poll fallback. Cross-fades the incoming frame in over 150ms by pinning
  // the previous frame on a lower layer while the new one transitions
  // opacity 0 → 1.
  const pushNewFrame = (id: string, url: string, ts: string) => {
    if (!url) return // empty URL from a failed presign — ignore, poll will retry
    if (id === lastIdRef.current) return
    lastIdRef.current = id
    setPrevUrl(currentUrlRef.current)
    currentUrlRef.current = url
    setCurrentUrl(url)
    setCapturedAt(ts)
    setCurrentOpacity(0)
    // Two rAFs so React commits the opacity-0 state before we flip it to 1.
    // Single rAF sometimes batches with the setState and skips the transition.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setCurrentOpacity(1))
    })
  }

  // Keep-alive — ping the watch flag on mount and every 15s while mounted.
  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      try {
        await api.post(startRoute)
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to start live view')
      }
    }
    ping()
    const id = setInterval(ping, KEEPALIVE_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
      // Fire-and-forget stop on unmount. Don't await — we want the modal to
      // close instantly, the agent picks up the TTL expiry within 1s.
      api.post(stopRoute).catch(() => {})
    }
  }, [startRoute, stopRoute])

  // Primary channel: WebSocket subscription. Listens for employee:screenshot,
  // filters by deviceId (or userId if no deviceId available), and pushes the
  // frame immediately on arrival. The server emit includes the presigned URL
  // so no follow-up REST call is needed.
  useEffect(() => {
    if (!socket) return
    const handler = (payload: {
      userId: string
      deviceId: string | null
      screenshotId: string
      capturedAt: string
      url: string
    }) => {
      // Filter to the machine we're watching. When the parent didn't pass a
      // deviceId (legacy user-centric flow) fall back to userId matching.
      if (deviceId) {
        if (payload.deviceId !== deviceId) return
      } else if (payload.userId !== userId) {
        return
      }
      pushNewFrame(payload.screenshotId, payload.url, payload.capturedAt)
    }
    socket.on('employee:screenshot', handler)
    return () => {
      socket.off('employee:screenshot', handler)
    }
    // pushNewFrame is stable (closed over refs/setters) so we intentionally
    // omit it from deps to avoid tearing down the subscription every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, deviceId, userId])

  // Fallback channel: HTTP poll at a slow 2s cadence. Only needed if the WS
  // drops, disconnects, or a specific emit gets lost. Uses the same
  // pushNewFrame path so dedupe/cross-fade behave identically.
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const params: Record<string, string | number> = { userId, limit: 1 }
        if (deviceId) params.deviceId = deviceId
        const { data } = await api.get('/monitoring/screenshots', { params })
        if (cancelled) return
        const shots = (data?.data ?? []) as LiveScreenshot[]
        if (shots.length === 0) return
        const latest = shots[0]
        pushNewFrame(latest.id, latest.url, latest.capturedAt)
      } catch {
        /* transient — next poll will retry */
      }
    }
    poll()
    const id = setInterval(poll, FRAME_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, deviceId])

  // Session timer.
  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const frameAgeSec = capturedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(capturedAt).getTime()) / 1000))
    : null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <h2 className="text-white text-lg font-semibold">{displayName}</h2>
          <span className="text-zinc-400 text-xs">LIVE</span>
          <span className="text-zinc-500 text-xs">
            · {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s
          </span>
          {frameAgeSec !== null && (
            <span className="text-zinc-500 text-xs">· frame {frameAgeSec}s ago</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-300 hover:text-white text-sm px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          Close
        </button>
      </div>

      {/* Frame — cross-fade between successive captures */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        {error ? (
          <div className="text-red-400 text-sm">Error: {error}</div>
        ) : currentUrl ? (
          <div className="relative w-full h-full">
            {prevUrl && prevUrl !== currentUrl && (
              <img
                src={prevUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-contain rounded-lg shadow-2xl"
              />
            )}
            <img
              src={currentUrl}
              alt="Live screen"
              className="absolute inset-0 w-full h-full object-contain rounded-lg shadow-2xl transition-opacity duration-150 ease-out"
              style={{ opacity: currentOpacity }}
              onTransitionEnd={() => {
                // Drop the previous layer once the fade completes so the DOM
                // doesn't accumulate stale <img> elements over a long session.
                setPrevUrl(null)
              }}
            />
          </div>
        ) : (
          <div className="text-zinc-500 text-sm flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
            <p>Waiting for first frame…</p>
            <p className="text-xs text-zinc-600">Agent wakes up within ~1 second</p>
          </div>
        )}
      </div>
    </div>
  )
}
