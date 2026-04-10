'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Monitor, Clock, Users, FolderKanban,
  BarChart3, Settings, Radio, MapPin, Bell, Plug, Download,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/overview',              label: 'Overview',      icon: LayoutDashboard },
  { href: '/settings/users',        label: 'Employees',     icon: Users           },
  { href: '/time-tracking',         label: 'Time Tracking', icon: Clock           },
  { href: '/monitoring',            label: 'Monitoring',    icon: Monitor         },
  { href: '/live',                  label: 'Live',          icon: Radio           },
  { href: '/projects',              label: 'Projects',      icon: FolderKanban    },
  { href: '/gps',                   label: 'GPS & Field',   icon: MapPin          },
  { href: '/analytics',             label: 'Analytics',     icon: BarChart3       },
  { href: '/integrations',          label: 'Integrations',  icon: Plug            },
  { href: '/alerts',                label: 'Alerts',        icon: Bell            },
  { href: '/settings/organization', label: 'Settings',      icon: Settings        },
  { href: '/settings/agent',        label: 'Agent Setup',   icon: Download        },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const userInitial = session?.user?.name?.charAt(0)?.toUpperCase() ?? 'U'

  return (
    <aside className="flex w-60 flex-col bg-slate-900 border-r border-slate-800 min-h-screen">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 shadow-md shadow-blue-900/40">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <span className="text-white font-bold text-base tracking-tight">TimeChamp</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800',
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User profile */}
      <div className="border-t border-slate-800 px-3 py-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {userInitial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-slate-200 text-xs font-medium truncate">{session?.user?.name ?? 'User'}</p>
            <p className="text-slate-500 text-xs truncate">{session?.user?.email ?? ''}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
