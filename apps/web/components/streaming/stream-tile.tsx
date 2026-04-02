'use client'

import { useEffect, useRef } from 'react'
import type { EmployeeStream } from '@/hooks/use-streaming'

interface Props {
  stream: EmployeeStream
  onExpand: () => void
}

export function StreamTile({ stream, onExpand }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stream.screenBitmap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(stream.screenBitmap, 0, 0, canvas.width, canvas.height)
  }, [stream.screenBitmap])

  const isStale = Date.now() - stream.lastFrameAt > 5000

  return (
    <div className="relative group rounded-lg overflow-hidden bg-zinc-900 border border-zinc-700">
      <canvas
        ref={canvasRef}
        width={320}
        height={180}
        className="w-full h-auto block"
      />
      {isStale && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-zinc-400 text-xs">
          {stream.lastFrameAt === 0 ? 'Waiting...' : 'Reconnecting...'}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
        <span className="text-white text-xs font-medium truncate">{stream.name}</span>
        <span className={`w-2 h-2 rounded-full ${stream.mode === 'idle' ? 'bg-zinc-500' : 'bg-green-400'}`} />
      </div>
      <button
        onClick={onExpand}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded px-2 py-1 text-white text-xs"
      >
        Expand
      </button>
    </div>
  )
}
