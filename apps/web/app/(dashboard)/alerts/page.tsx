// apps/web/app/(dashboard)/alerts/page.tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  useAlertRules,
  useAlertEvents,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useMarkSeen,
  ALERT_TYPE_LABELS,
  ALERT_TYPE_ICONS,
  ALERT_TYPES,
  type AlertType,
  type AlertRule,
  type CreateAlertRulePayload,
} from '@/hooks/use-alerts';

// ── Add Rule Modal ──────────────────────────────────────────────────────

function AddRuleModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateAlertRulePayload>({
    name: '',
    type: 'idle_too_long',
    threshold: 30,
    enabled: true,
    notifyEmail: true,
    notifyInApp: true,
  });
  const { mutate: createRule, isPending } = useCreateAlertRule();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    createRule({ ...form, name: form.name.trim() }, { onSuccess: onClose });
  };

  const thresholdLabel =
    form.type === 'productivity_below' ? 'Threshold (%)' : 'Threshold (minutes)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-800">Add Alert Rule</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rule Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Long idle alert"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Alert Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AlertType }))}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {ALERT_TYPES.map((t) => (
                <option key={t} value={t}>{ALERT_TYPE_ICONS[t]} {ALERT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{thresholdLabel}</label>
            <input
              type="number"
              value={form.threshold ?? 30}
              min={1}
              max={form.type === 'productivity_below' ? 100 : 10000}
              onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-600">Notifications</label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.notifyEmail}
                onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.checked }))} className="rounded" />
              Send email notification
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.notifyInApp}
                onChange={(e) => setForm((f) => ({ ...f, notifyInApp: e.target.checked }))} className="rounded" />
              Send in-app notification
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={isPending} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {isPending ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Rule Row ───────────────────────────────────────────────────────────

function RuleRow({ rule, isAdmin }: { rule: AlertRule; isAdmin: boolean }) {
  const { mutate: updateRule, isPending: updating } = useUpdateAlertRule();
  const { mutate: deleteRule, isPending: deleting } = useDeleteAlertRule();

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 text-sm font-medium text-slate-800">
        <span className="mr-2">{ALERT_TYPE_ICONS[rule.type]}</span>{rule.name}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">{ALERT_TYPE_LABELS[rule.type]}</td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {rule.type === 'productivity_below' ? `${rule.threshold}%` : `${rule.threshold} min`}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {rule.notifyEmail && <span className="inline-block mr-1 px-1.5 py-0.5 rounded bg-slate-100">Email</span>}
        {rule.notifyInApp && <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100">In-app</span>}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${rule.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {rule.enabled ? 'Active' : 'Disabled'}
        </span>
      </td>
      {isAdmin && (
        <td className="px-4 py-3 text-right space-x-3">
          <button onClick={() => updateRule({ id: rule.id, enabled: !rule.enabled })} disabled={updating}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50">
            {rule.enabled ? 'Disable' : 'Enable'}
          </button>
          <button onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteRule(rule.id); }} disabled={deleting}
            className="text-xs text-red-500 hover:underline disabled:opacity-50">
            Delete
          </button>
        </td>
      )}
    </tr>
  );
}

// ── Events Tab ─────────────────────────────────────────────────────────

function EventsTab() {
  const { data: events, isLoading } = useAlertEvents();
  const { mutate: markSeen, isPending: marking } = useMarkSeen();

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading events...</div>;
  if (!events?.length) return (
    <div className="p-10 text-center text-sm text-slate-500">
      No alert events yet. Events appear here when alert rules are triggered.
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-slate-600">Type</th>
            <th className="text-left px-4 py-2.5 font-medium text-slate-600">Message</th>
            <th className="text-left px-4 py-2.5 font-medium text-slate-600">Triggered</th>
            <th className="text-left px-4 py-2.5 font-medium text-slate-600">Status</th>
            <th className="text-right px-4 py-2.5 font-medium text-slate-600">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {events.map((event) => (
            <tr key={event.id} className={`hover:bg-slate-50 transition-colors ${!event.seenAt ? 'bg-amber-50/40' : ''}`}>
              <td className="px-4 py-3 whitespace-nowrap">
                {event.type ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <span>{ALERT_TYPE_ICONS[event.type]}</span>
                    <span>{ALERT_TYPE_LABELS[event.type]}</span>
                  </span>
                ) : <span className="text-slate-400 text-xs">Unknown</span>}
              </td>
              <td className="px-4 py-3 text-slate-600 max-w-sm">{event.message ?? (event.rule?.name ?? '—')}</td>
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                {new Date(event.triggeredAt).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                {event.seenAt
                  ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Seen</span>
                  : <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Unread</span>}
              </td>
              <td className="px-4 py-3 text-right">
                {!event.seenAt && (
                  <button onClick={() => markSeen(event.id)} disabled={marking}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50">Mark seen</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rules Tab ──────────────────────────────────────────────────────────

function RulesTab({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [showModal, setShowModal] = useState(false);
  const { data: rules, isLoading } = useAlertRules();

  if (!isManager) return (
    <div className="p-6 text-sm text-amber-700 bg-amber-50 rounded-lg border border-amber-200">
      Alert rules can only be viewed and managed by managers and admins.
    </div>
  );

  return (
    <>
      {showModal && <AddRuleModal onClose={() => setShowModal(false)} />}
      <div className="flex justify-end mb-4">
        {isAdmin && (
          <button onClick={() => setShowModal(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            + Add Rule
          </button>
        )}
      </div>
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-400">Loading rules...</div>
        ) : !rules?.length ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No alert rules configured.
            {isAdmin && <button onClick={() => setShowModal(true)} className="ml-2 text-blue-600 hover:underline">Add your first rule</button>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Threshold</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Notify</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Status</th>
                {isAdmin && <th className="text-right px-4 py-2.5 font-medium text-slate-600">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((rule) => <RuleRow key={rule.id} rule={rule} isAdmin={isAdmin} />)}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

type Tab = 'events' | 'rules';

export default function AlertsPage() {
  const { data: session, status } = useSession();
  const [tab, setTab] = useState<Tab>('events');

  if (status === 'loading') return (
    <><Header title="Alerts" /><div className="p-6 text-slate-400 text-sm">Loading...</div></>
  );

  const isAdmin = session?.user?.role === 'admin';
  const isManager = isAdmin || session?.user?.role === 'manager';

  return (
    <>
      <Header title="Alerts" />
      <div className="p-6 max-w-5xl space-y-4">
        <div className="flex border-b border-slate-200">
          {(['events', 'rules'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t === 'events' ? 'Alert Events' : 'Rules'}
            </button>
          ))}
        </div>
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          {tab === 'events' ? <EventsTab /> : <div className="p-6"><RulesTab isAdmin={isAdmin} isManager={isManager} /></div>}
        </div>
      </div>
    </>
  );
}
