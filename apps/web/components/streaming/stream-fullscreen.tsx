'use client'

import { useEffect, useRef } from 'react'
import type { EmployeeStream } from '@/hooks/use-streaming'
import { AudioWaveform } from './audio-waveform'
import { CameraPip } from './camera-pip'

interface Props {
  stream: EmployeeStream
  onClose: () => void
}

export function StreamFullscreen({ stream, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stream.screenBitmap) return
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(stream.screenBitmap, 0, 0, canvas.width, canvas.height)
  }, [stream.screenBitmap])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center">
      <div className="relative w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold">{stream.name}</span>
            <AudioWaveform level={stream.audioLevel} />
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors text-sm">
            Close
          </button>
        </div>

        {/* Main screen canvas */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="w-full h-auto rounded-lg border border-zinc-700"
          />
          <CameraPip bitmap={stream.cameraBitmap} />
        </div>
      </div>
    </div>
  )
}
