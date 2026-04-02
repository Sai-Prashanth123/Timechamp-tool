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
  useAcknowledgeAlert,
  METRIC_LABELS,
  type AlertMetric,
  type AlertRule,
} from '@/hooks/use-alerts';

// ── Create Rule Form ───────────────────────────────────────────────────

const METRICS: AlertMetric[] = ['idle_time', 'no_activity', 'late_clock_in', 'missed_clock_in'];

function CreateRuleForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<AlertMetric>('idle_time');
  const [threshold, setThreshold] = useState(30);

  const { mutate: createRule, isPending } = useCreateAlertRule();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createRule(
      { name: name.trim(), metric, thresholdMinutes: threshold },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border rounded-lg bg-slate-50">
      <h4 className="text-sm font-semibold text-slate-700">New Alert Rule</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Rule Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Long idle alert"
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Metric
          </label>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as AlertMetric)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Threshold (minutes)
          </label>
          <input
            type="number"
            value={threshold}
            min={1}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Creating...' : 'Create Rule'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Rule Row ───────────────────────────────────────────────────────────

function RuleRow({ rule, isAdmin }: { rule: AlertRule; isAdmin: boolean }) {
  const { mutate: updateRule, isPending: updating } = useUpdateAlertRule();
  const { mutate: deleteRule, isPending: deleting } = useDeleteAlertRule();

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2 text-sm font-medium text-slate-800">{rule.name}</td>
      <td className="px-4 py-2 text-sm text-slate-600">{METRIC_LABELS[rule.metric]}</td>
      <td className="px-4 py-2 text-sm text-slate-600">{rule.thresholdMinutes} min</td>
      <td className="px-4 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            rule.isActive
              ? 'bg-green-100 text-green-700'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {rule.isActive ? 'Active' : 'Inactive'}
        </span>
      </td>
      {isAdmin && (
        <td className="px-4 py-2 text-right space-x-2">
          <button
            onClick={() => updateRule({ id: rule.id, isActive: !rule.isActive })}
            disabled={updating}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            {rule.isActive ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete rule "${rule.name}"?`)) {
                deleteRule(rule.id);
              }
            }}
            disabled={deleting}
            className="text-xs text-red-500 hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        </td>
      )}
    </tr>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { data: session, status } = useSession();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: rules, isLoading: rulesLoading } = useAlertRules();
  const { data: events, isLoading: eventsLoading } = useAlertEvents();
  const { mutate: acknowledgeAlert, isPending: acknowledging } = useAcknowledgeAlert();

  if (status === 'loading') {
    return (
      <>
        <Header title="Alerts" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  const isAdmin = session?.user?.role === 'admin';
  const isManager = isAdmin || session?.user?.role === 'manager';

  return (
    <>
      <Header title="Alerts" />
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Access restriction notice */}
        {!isManager && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Alert settings can only be viewed by managers and admins.
          </div>
        )}

        {/* Recent Alert Events */}
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-3">Recent Alert Events</h2>
          <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
            {eventsLoading ? (
              <div className="p-6 text-sm text-slate-400">Loading events...</div>
            ) : !events || events.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No alert events yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Metric</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Value</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Threshold</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Triggered</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
                    {isManager && (
                      <th className="text-right px-4 py-2 font-medium text-slate-600">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.map((event) => (
                    <tr key={event.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-700">
                        {METRIC_LABELS[event.metric]}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{event.valueMinutes} min</td>
                      <td className="px-4 py-2 text-slate-600">{event.thresholdMinutes} min</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {new Date(event.triggeredAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        {event.acknowledgedAt ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Acknowledged
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                            Unacknowledged
                          </span>
                        )}
                      </td>
                      {isManager && (
                        <td className="px-4 py-2 text-right">
                          {!event.acknowledgedAt && (
                            <button
                              onClick={() => acknowledgeAlert(event.id)}
                              disabled={acknowledging}
                              className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                            >
                              Acknowledge
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Alert Rules */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800">Alert Rules</h2>
            {isAdmin && !showCreateForm && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                + New Rule
              </button>
            )}
          </div>

          {showCreateForm && (
            <div className="mb-4">
              <CreateRuleForm onDone={() => setShowCreateForm(false)} />
            </div>
          )}

          <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
            {rulesLoading ? (
              <div className="p-6 text-sm text-slate-400">Loading rules...</div>
            ) : !rules || rules.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No alert rules configured yet.
                {isAdmin && (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="ml-2 text-blue-600 hover:underline"
                  >
                    Create your first rule
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Name</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Metric</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Threshold</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
                    {isAdmin && (
                      <th className="text-right px-4 py-2 font-medium text-slate-600">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rules.map((rule) => (
                    <RuleRow key={rule.id} rule={rule} isAdmin={isAdmin} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
