'use client'

import { useEffect, useRef } from 'react'

interface Props {
  bitmap: ImageBitmap | null
}

export function CameraPip({ bitmap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }, [bitmap])

  if (!bitmap) return null

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={120}
      className="absolute bottom-4 right-4 rounded border border-zinc-600 shadow-lg"
    />
  )
}
