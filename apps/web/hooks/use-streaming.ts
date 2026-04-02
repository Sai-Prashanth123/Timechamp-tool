import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

export type StreamMode = 'idle' | 'grid' | 'full'

export interface EmployeeStream {
  userId: string
  name: string
  avatar?: string
  lastFrameAt: number
  mode: StreamMode
  screenBitmap: ImageBitmap | null
  cameraBitmap: ImageBitmap | null
  audioLevel: number   // 0-1 RMS from last audio chunk
}

// Frame type bytes matching Go agent protocol
const FRAME_TYPE_SCREEN_DELTA = 0x01
const FRAME_TYPE_SCREEN_FULL  = 0x02
const FRAME_TYPE_CAMERA       = 0x03
const FRAME_TYPE_AUDIO        = 0x04

function parseFrame(buf: ArrayBuffer): { type: number; payload: ArrayBuffer } | null {
  if (buf.byteLength < 8) return null
  const view = new DataView(buf)
  // [1B version][1B type][2B reserved][4B payload_len]
  const type = view.getUint8(1)
  const payloadLen = view.getUint32(4, false) // big-endian
  if (buf.byteLength < 8 + payloadLen) return null
  return { type, payload: buf.slice(8, 8 + payloadLen) }
}

function computeAudioLevel(pcm: ArrayBuffer): number {
  // 16-bit signed LE PCM — compute RMS normalized to 0-1
  let sumSq = 0
  const samples = Math.floor(pcm.byteLength / 2)
  const view = new DataView(pcm)
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true) / 32768
    sumSq += s * s
  }
  return Math.sqrt(sumSq / Math.max(1, samples))
}

export function useStreaming(apiUrl: string, token: string) {
  const socketRef = useRef<Socket | null>(null)
  const [streams, setStreams] = useState<Map<string, EmployeeStream>>(new Map())
  const streamsRef = useRef<Map<string, EmployeeStream>>(new Map())

  const updateStream = useCallback((userId: string, patch: Partial<EmployeeStream>) => {
    const current = streamsRef.current.get(userId) ?? {
      userId,
      name: userId,
      lastFrameAt: 0,
      mode: 'idle' as StreamMode,
      screenBitmap: null,
      cameraBitmap: null,
      audioLevel: 0,
    }
    const next = { ...current, ...patch }
    streamsRef.current = new Map(streamsRef.current).set(userId, next)
    setStreams(new Map(streamsRef.current))
  }, [])

  useEffect(() => {
    const socket = io(`${apiUrl}/stream`, {
      auth: { token },
      transports: ['websocket'],
    })
    socketRef.current = socket

    // Gateway emits: server.to(`org:${orgId}`).emit('stream:online', { userId })
    // name/avatar not included in gateway — use userId as display name until enriched
    socket.on('stream:online', ({ userId }: { userId: string }) => {
      updateStream(userId, { userId, name: userId })
    })

    socket.on('stream:offline', ({ userId }: { userId: string }) => {
      setStreams(prev => {
        const next = new Map(prev)
        next.delete(userId)
        streamsRef.current = next
        return next
      })
    })

    // Gateway emits: this.server.to(room).emit('stream:frame', data, conn.userId, type)
    // Socket.IO passes multiple args — handler receives (data: Buffer, userId: string, type: number)
    socket.on('stream:frame', async (data: ArrayBuffer, userId: string) => {
      const frame = parseFrame(data)
      if (!frame) return

      if (frame.type === FRAME_TYPE_SCREEN_FULL || frame.type === FRAME_TYPE_SCREEN_DELTA) {
        // For full frames and delta frames, decode as JPEG blob → ImageBitmap
        // (Full delta reconstruction would need canvas patching; treat as JPEG for MVP)
        const blob = new Blob([frame.payload], { type: 'image/jpeg' })
        try {
          const bitmap = await createImageBitmap(blob)
          const prev = streamsRef.current.get(userId)
          prev?.screenBitmap?.close()
          updateStream(userId, { screenBitmap: bitmap, lastFrameAt: Date.now() })
        } catch { /* decode error — keep previous frame */ }

      } else if (frame.type === FRAME_TYPE_CAMERA) {
        const blob = new Blob([frame.payload], { type: 'image/jpeg' })
        try {
          const bitmap = await createImageBitmap(blob)
          const prev = streamsRef.current.get(userId)
          prev?.cameraBitmap?.close()
          updateStream(userId, { cameraBitmap: bitmap })
        } catch { /* ignore */ }

      } else if (frame.type === FRAME_TYPE_AUDIO) {
        const level = computeAudioLevel(frame.payload)
        updateStream(userId, { audioLevel: level })
      }
    })

    socket.on('stream:mode_changed', ({ userId, mode }: { userId: string; mode: StreamMode }) => {
      updateStream(userId, { mode })
    })

    return () => {
      socket.disconnect()
    }
  }, [apiUrl, token, updateStream])

  // Gateway uses 'subscribe'/'unsubscribe' event names
  const subscribe = useCallback((userId: string) => {
    socketRef.current?.emit('subscribe', { userId })
  }, [])

  const unsubscribe = useCallback((userId: string) => {
    socketRef.current?.emit('unsubscribe', { userId })
  }, [])

  // No dedicated fullscreen event in gateway — mode changes are agent-side
  // These are kept for UI state management only
  const requestFullscreen = useCallback((_userId: string) => {
    // No-op: fullscreen mode is UI-only; the agent controls its own capture mode
  }, [])

  const stopFullscreen = useCallback((_userId: string) => {
    // No-op: fullscreen mode is UI-only
  }, [])

  return { streams, subscribe, unsubscribe, requestFullscreen, stopFullscreen }
}
