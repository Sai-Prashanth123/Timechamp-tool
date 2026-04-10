'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useStreaming } from '@/hooks/use-streaming'
import { StreamGrid } from '@/components/streaming/stream-grid'

// Strip /api/v1 — Socket.io namespaces live on the root server URL, not the REST base path
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/api\/v\d+\/?$/, '')

export function LivePageClient({ token }: { token: string }) {
  const searchParams = useSearchParams()
  const focusUserId = searchParams.get('focus')

  const {
    streams,
    subscribe,
    unsubscribe,
    requestFullscreen,
    stopFullscreen,
    requestStream,
    stopStream,
    muteStream,
    mutedStreams,
  } = useStreaming(API_URL, token)

  // Auto-request stream for focused user when navigating from Watch Live button
  useEffect(() => {
    if (focusUserId) {
      requestStream(focusUserId)
    }
  }, [focusUserId, requestStream])

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="px-4 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Live Monitoring</h1>
        <span className="text-zinc-400 text-sm">{streams.size} online</span>
      </div>
      <StreamGrid
        streams={streams}
        subscribe={subscribe}
        unsubscribe={unsubscribe}
        requestFullscreen={requestFullscreen}
        stopFullscreen={stopFullscreen}
        stopStream={stopStream}
        muteStream={muteStream}
        mutedStreams={mutedStreams}
      />
    </div>
  )
}
