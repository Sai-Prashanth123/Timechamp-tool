'use client'

import { useStreaming } from '@/hooks/use-streaming'
import { StreamGrid } from '@/components/streaming/stream-grid'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function LivePageClient({ token }: { token: string }) {
  const { streams, subscribe, unsubscribe, requestFullscreen, stopFullscreen } = useStreaming(API_URL, token)

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
      />
    </div>
  )
}
