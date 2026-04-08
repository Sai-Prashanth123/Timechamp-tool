'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { StatCard } from '@/components/ui/stat-card';
import { StatCardRowSkeleton } from '@/components/ui/loading-skeleton';
import {
  useOrgStats,
  useAdminUsers,
  useChangeUserRole,
  useDeactivateUser,
  useReactivateUser,
  useAuditLog,
} from '@/hooks/use-admin';
import { Users, Clock, Monitor, Shield } from 'lucide-react';

type Tab = 'overview' | 'users' | 'audit';

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');

  if (status === 'authenticated' && session?.user?.role !== 'admin') {
    router.replace('/dashboard');
    return null;
  }

  if (status === 'loading') {
    return (
      <>
        <Header title="Admin" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  return (
    <>
      <Header title="Admin Dashboard" />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Tab bar */}
        <div className="flex border-b border-slate-200">
          {(['overview', 'users', 'audit'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'audit' ? 'Audit Log' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </>
  );
}

function OverviewTab() {
  const { data: stats, isLoading } = useOrgStats();

  if (isLoading) return <StatCardRowSkeleton count={4} />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard
        title="Total Users"
        value={stats?.totalUsers ?? 0}
        icon={<Users className="w-4 h-4" />}
        iconColor="bg-blue-500"
      />
      <StatCard
        title="Active Today"
        value={stats?.activeToday ?? 0}
        icon={<Monitor className="w-4 h-4" />}
        iconColor="bg-emerald-500"
      />
      <StatCard
        title="Hours This Week"
        value={`${stats?.hoursThisWeek ?? 0}h`}
        icon={<Clock className="w-4 h-4" />}
        iconColor="bg-violet-500"
      />
      <StatCard
        title="Admins"
        value={stats?.adminCount ?? 0}
        icon={<Shield className="w-4 h-4" />}
        iconColor="bg-amber-500"
      />
    </div>
  );
}

function UsersTab() {
  const { data: users = [], isLoading } = useAdminUsers();
  const { mutate: changeRole } = useChangeUserRole();
  const { mutate: deactivate } = useDeactivateUser();
  const { mutate: reactivate } = useReactivateUser();

  if (isLoading) {
    return <div className="text-sm text-slate-400 p-4">Loading users...</div>;
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-slate-600">User</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-800">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </td>
              <td className="px-4 py-3">
                <select
                  defaultValue={user.role}
                  onChange={(e) => changeRole({ userId: user.id, role: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  user.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                {user.isActive ? (
                  <button
                    onClick={() => {
                      if (confirm(`Deactivate ${user.email}?`)) deactivate(user.id);
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => reactivate(user.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Reactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const { data, isLoading } = useAuditLog({ limit: 50 });
  const logs = data?.logs ?? [];

  if (isLoading) return <div className="text-sm text-slate-400 p-4">Loading audit log...</div>;
  if (!logs.length) {
    return (
      <div className="text-sm text-slate-500 p-8 text-center rounded-lg border bg-white">
        No audit log entries yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Time</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Actor</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Resource</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-xs text-slate-700">{log.actorEmail}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">
                  {log.action}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                <span className="text-slate-500">{log.resourceType}</span>
                {log.resourceId && (
                  <span className="ml-1 font-mono text-[10px] text-slate-400">
                    #{log.resourceId.slice(0, 8)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
