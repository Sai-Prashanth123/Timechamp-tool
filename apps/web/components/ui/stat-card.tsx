// apps/web/components/ui/stat-card.tsx
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  change?: string         // e.g. "+12%" or "-3%"
  changePositive?: boolean
  icon: ReactNode
  iconColor?: string      // Tailwind bg class e.g. "bg-blue-500"
  loading?: boolean
  className?: string
}

export function StatCard({
  title,
  value,
  change,
  changePositive,
  icon,
  iconColor = 'bg-blue-500',
  loading = false,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <div className={cn(
        'relative overflow-hidden rounded-2xl border border-white/10 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md p-5 shadow-sm',
        className,
      )}>
        <div className="animate-pulse space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-9 w-9 rounded-xl bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="h-8 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'group relative overflow-hidden rounded-2xl border border-white/10 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md p-5 shadow-sm transition-all hover:shadow-md hover:border-blue-500/30',
      className,
    )}>
      {/* Gradient glow accent */}
      <div className="pointer-events-none absolute -top-6 -right-6 h-24 w-24 rounded-full bg-blue-500/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
        <div className={cn(
          'flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm',
          iconColor,
        )}>
          {icon}
        </div>
      </div>

      <p className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 dark:text-white tabular-nums">
        {value}
      </p>

      {change !== undefined && (
        <p className={cn(
          'mt-1 text-xs font-medium',
          changePositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
        )}>
          {change} vs last week
        </p>
      )}
    </div>
  )
}
