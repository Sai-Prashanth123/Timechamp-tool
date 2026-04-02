'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { EmployeeStream } from '@/hooks/use-streaming'
import { StreamTile } from './stream-tile'
import { StreamFullscreen } from './stream-fullscreen'

interface Props {
  streams: Map<string, EmployeeStream>
  subscribe: (userId: string) => void
  unsubscribe: (userId: string) => void
  requestFullscreen: (userId: string) => void
  stopFullscreen: (userId: string) => void
}

export function StreamGrid({ streams, subscribe, unsubscribe, requestFullscreen, stopFullscreen }: Props) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [fullscreenUserId, setFullscreenUserId] = useState<string | null>(null)

  const handleExpand = useCallback((userId: string) => {
    setFullscreenUserId(userId)
    requestFullscreen(userId)
  }, [requestFullscreen])

  const handleCloseFullscreen = useCallback(() => {
    if (fullscreenUserId) {
      stopFullscreen(fullscreenUserId)
    }
    setFullscreenUserId(null)
  }, [fullscreenUserId, stopFullscreen])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const userId = (entry.target as HTMLElement).dataset.userId
          if (!userId) return
          if (entry.isIntersecting) {
            subscribe(userId)
          } else {
            unsubscribe(userId)
          }
        })
      },
      { threshold: 0.1 }
    )

    tileRefs.current.forEach((el) => observerRef.current?.observe(el))
    return () => observerRef.current?.disconnect()
  }, [subscribe, unsubscribe])

  const setTileRef = useCallback((userId: string, el: HTMLDivElement | null) => {
    if (el) {
      tileRefs.current.set(userId, el)
      observerRef.current?.observe(el)
    } else {
      const prev = tileRefs.current.get(userId)
      if (prev) observerRef.current?.unobserve(prev)
      tileRefs.current.delete(userId)
    }
  }, [])

  const streamList = Array.from(streams.values())

  if (streamList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
        <p className="text-lg">No employees online</p>
        <p className="text-sm mt-1">Employees will appear here when the agent connects</p>
      </div>
    )
  }

  const fullscreenStream = fullscreenUserId ? streams.get(fullscreenUserId) : null

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-4">
        {streamList.map(stream => (
          <div
            key={stream.userId}
            ref={el => setTileRef(stream.userId, el)}
            data-user-id={stream.userId}
          >
            <StreamTile
              stream={stream}
              onExpand={() => handleExpand(stream.userId)}
            />
          </div>
        ))}
      </div>
      {fullscreenStream && (
        <StreamFullscreen
          stream={fullscreenStream}
          onClose={handleCloseFullscreen}
        />
      )}
    </>
  )
}
