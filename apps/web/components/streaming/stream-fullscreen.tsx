'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Volume2, VolumeX, Camera, X, StopCircle } from 'lucide-react'
import type { EmployeeStream } from '@/hooks/use-streaming'
import { AudioWaveform } from './audio-waveform'
import { CameraPip } from './camera-pip'
import api from '@/lib/api'

type Quality = 'HD' | 'SD' | 'Low'

const QUALITY_LABELS: Record<Quality, string> = {
  HD: 'HD · 30fps',
  SD: 'SD · 15fps',
  Low: 'Low · 5fps',
}

const QUALITY_MODE: Record<Quality, 'full' | 'grid'> = {
  HD: 'full',
  SD: 'grid',
  Low: 'grid',
}

interface Props {
  stream: EmployeeStream
  onClose: () => void
  stopStream?: (userId: string) => Promise<void>
  muteStream?: (userId: string, muted: boolean) => void
  isMuted?: boolean
}

export function StreamFullscreen({ stream, onClose, stopStream, muteStream, isMuted = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [quality, setQuality] = useState<Quality>('HD')
  const [elapsed, setElapsed] = useState(0)
  const mountedAt = useRef(Date.now())

  // Draw frames to canvas
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

  // Session timer — tick every second
  useEffect(() => {
    mountedAt.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - mountedAt.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [stream.userId])

  // Apply quality change via API
  const handleQuality = useCallback(async (q: Quality) => {
    setQuality(q)
    try {
      await api.post(`/streaming/sessions/${stream.userId}/mode`, { mode: QUALITY_MODE[q] })
    } catch {
      // ignore — quality label still updates locally
    }
  }, [stream.userId])

  // Screenshot — capture current canvas frame as PNG download
  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob: Blob | null) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `screenshot-${stream.name}-${new Date().toISOString()}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }, [stream.name])

  // Stop stream and close fullscreen
  const handleStop = useCallback(async () => {
    if (stopStream) {
      await stopStream(stream.userId)
    }
    onClose()
  }, [stopStream, stream.userId, onClose])

  // Toggle mute
  const handleMute = useCallback(() => {
    muteStream?.(stream.userId, !isMuted)
  }, [muteStream, stream.userId, isMuted])

  // Format elapsed seconds as MM:SS or HH:MM:SS
  const formatElapsed = (secs: number): string => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    if (h > 0) return `${h}:${mm}:${ss}`
    return `${mm}:${ss}`
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center">
      <div className="relative w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold">{stream.name}</span>
            <AudioWaveform level={stream.audioLevel} />
            {/* Session timer */}
            <span className="text-xs text-zinc-400 tabular-nums font-mono">
              {formatElapsed(elapsed)}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Quality selector */}
            <div className="flex items-center gap-1 bg-zinc-800 rounded-md p-0.5">
              {(['HD', 'SD', 'Low'] as Quality[]).map(q => (
                <button
                  key={q}
                  onClick={() => handleQuality(q)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    quality === q
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  title={QUALITY_LABELS[q]}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Screenshot button */}
            <button
              onClick={handleScreenshot}
              className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded hover:bg-zinc-800"
              title="Take screenshot"
            >
              <Camera size={16} />
            </button>

            {/* Mute toggle */}
            <button
              onClick={handleMute}
              className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded hover:bg-zinc-800"
              title={isMuted ? 'Unmute' : 'Mute audio'}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>

            {/* Stop stream button */}
            {stopStream && (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                title="Stop stream"
              >
                <StopCircle size={14} />
                Stop
              </button>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded hover:bg-zinc-800"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
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
