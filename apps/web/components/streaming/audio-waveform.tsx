'use client'

interface Props {
  level: number  // 0-1 RMS
  bars?: number
}

export function AudioWaveform({ level, bars = 12 }: Props) {
  return (
    <div className="flex items-end gap-0.5 h-8">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = i / bars
        const active = level > threshold
        return (
          <div
            key={i}
            className={`w-1 rounded-sm transition-all duration-100 ${active ? 'bg-green-400' : 'bg-zinc-700'}`}
            style={{ height: `${Math.round(((i + 1) / bars) * 100)}%` }}
          />
        )
      })}
    </div>
  )
}
