'use client';

import { Header } from '@/components/dashboard/header';
import { useLiveStatus, elapsedSince } from '@/hooks/use-monitoring';
import { useTimesheets } from '@/hooks/use-time-tracking';
import { useProjects } from '@/hooks/use-projects';
import { useMonitoringStore } from '@/stores/monitoring-store';

// ── Stat Card ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-900">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-slate-400">{sublabel}</p>}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { data: liveEmployees, isLoading: liveLoading } = useLiveStatus();
  const { data: timesheets, isLoading: tsLoading } = useTimesheets();
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const storeEmployees = useMonitoringStore((s) => s.employees);

  const onlineCount = liveEmployees?.length ?? 0;

  // Total minutes tracked today from open attendances (rough estimate via clock-in time)
  const totalMinutesToday = liveEmployees?.reduce((sum, emp) => {
    const ms = Date.now() - new Date(emp.clockedInSince).getTime();
    return sum + Math.floor(ms / 60_000);
  }, 0) ?? 0;
  const hoursToday = Math.floor(totalMinutesToday / 60);
  const minsToday = totalMinutesToday % 60;
  const timeTodayLabel = `${hoursToday}h ${minsToday}m`;

  const activeProjects = projects?.filter((p) => p.status === 'active').length ?? 0;
  const pendingTimesheets = timesheets?.filter((ts) => ts.status === 'submitted').length ?? 0;

  const isLoading = liveLoading || tsLoading || projectsLoading;

  return (
    <>
      <Header title="Overview" />
      <div className="flex-1 p-6 space-y-6 max-w-7xl">
        {/* Stats Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Employees Online Now"
            value={isLoading ? '...' : onlineCount}
            sublabel="Currently clocked in"
          />
          <StatCard
            label="Time Tracked Today"
            value={isLoading ? '...' : timeTodayLabel}
            sublabel="Across all clocked-in employees"
          />
          <StatCard
            label="Active Projects"
            value={isLoading ? '...' : activeProjects}
            sublabel="Projects in progress"
          />
          <StatCard
            label="Pending Approvals"
            value={isLoading ? '...' : pendingTimesheets}
            sublabel="Timesheets awaiting review"
          />
        </div>

        {/* At a Glance cards */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Clocked-in employees */}
          <div className="rounded-lg border bg-white p-5 shadow-sm col-span-2">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Live Team Activity
            </h3>
            {liveLoading ? (
              <p className="text-sm text-slate-400">Loading...</p>
            ) : !liveEmployees || liveEmployees.length === 0 ? (
              <p className="text-sm text-slate-500">
                No employees are currently clocked in.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {liveEmployees.slice(0, 8).map((emp) => {
                  const live = storeEmployees[emp.userId];
                  // Fall back to 'online' since REST only returns active employees
                  const status = live?.status ?? 'online';
                  const dotColour =
                    status === 'online'
                      ? 'bg-green-400'
                      : status === 'idle'
                      ? 'bg-yellow-400'
                      : 'bg-slate-300';
                  return (
                    <li
                      key={emp.userId}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${dotColour}`} />
                        <a
                          href={`/monitoring/${emp.userId}`}
                          className="text-sm font-medium text-slate-800 hover:text-blue-600 hover:underline"
                        >
                          {emp.firstName} {emp.lastName}
                        </a>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>{live?.activeApp ?? emp.currentApp ?? 'Idle'}</p>
                        <p className="text-slate-400">
                          {elapsedSince(emp.clockedInSince)} elapsed
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Quick info */}
          <div className="space-y-4">
            {/* Pending timesheets */}
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Timesheet Approvals
              </h3>
              {tsLoading ? (
                <p className="text-sm text-slate-400">Loading...</p>
              ) : pendingTimesheets === 0 ? (
                <p className="text-sm text-green-600 font-medium">All caught up!</p>
              ) : (
                <p className="text-sm text-amber-600 font-medium">
                  {pendingTimesheets} timesheet{pendingTimesheets !== 1 ? 's' : ''} pending approval
                </p>
              )}
              <a
                href="/time-tracking"
                className="mt-2 inline-block text-xs text-blue-600 hover:underline"
              >
                Go to Time Tracking
              </a>
            </div>

            {/* Active projects */}
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Project Status
              </h3>
              {projectsLoading ? (
                <p className="text-sm text-slate-400">Loading...</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">{activeProjects}</span> active
                  </p>
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">
                      {projects?.filter((p) => p.status === 'completed').length ?? 0}
                    </span>{' '}
                    completed
                  </p>
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">
                      {projects?.filter((p) => p.status === 'on_hold').length ?? 0}
                    </span>{' '}
                    on hold
                  </p>
                </div>
              )}
              <a
                href="/projects"
                className="mt-2 inline-block text-xs text-blue-600 hover:underline"
              >
                Go to Projects
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
