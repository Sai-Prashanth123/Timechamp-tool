'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  Clock,
  FolderKanban,
  MapPin,
  BarChart3,
  Plug,
  Bell,
  Settings,
  Monitor,
} from 'lucide-react';

const navItems = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/time-tracking', label: 'Time Tracking', icon: Clock },
  { href: '/monitoring', label: 'Monitoring', icon: Monitor },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/gps', label: 'GPS & Field', icon: MapPin },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/settings/organization', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-white flex flex-col shrink-0">
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-xl font-bold text-white tracking-tight">
          TimeChamp
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Workforce Intelligence</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <p className="text-xs text-slate-500">v1.0.0-alpha</p>
      </div>
    </aside>
  );
}
