// apps/web/components/dashboard/notification-bell.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import {
  useUnreadCount,
  useAlertEvents,
  useMarkSeen,
  ALERT_TYPE_ICONS,
  ALERT_TYPE_LABELS,
} from '@/hooks/use-alerts';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { data: count = 0 } = useUnreadCount();
  const { data: events = [] } = useAlertEvents();
  const { mutate: markSeen } = useMarkSeen();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const recentEvents = events.slice(0, 5);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {count > 0 && <span className="text-xs text-slate-400">{count} unread</span>}
          </div>

          {recentEvents.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No recent alerts</div>
          ) : (
            <ul className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
              {recentEvents.map((event) => (
                <li
                  key={event.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors ${!event.seenAt ? 'bg-amber-50/60' : ''}`}
                >
                  <span className="mt-0.5 text-base flex-shrink-0">
                    {event.type ? ALERT_TYPE_ICONS[event.type] : '🔔'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">
                      {event.type ? ALERT_TYPE_LABELS[event.type] : 'Alert'}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {event.message ?? '—'}
                    </p>
                  </div>
                  {!event.seenAt && (
                    <button
                      onClick={() => markSeen(event.id)}
                      className="flex-shrink-0 text-[10px] text-blue-500 hover:underline mt-0.5"
                    >
                      Seen
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="px-4 py-2.5 border-t border-slate-100">
            <button
              onClick={() => { setOpen(false); router.push('/alerts'); }}
              className="text-xs text-blue-600 hover:underline w-full text-center"
            >
              View all alerts →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
