'use client';

import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SlackSection } from '@/components/integrations/slack-section';
import { WebhookList } from '@/components/integrations/webhook-list';

export default function IntegrationsPage() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <>
        <Header title="Integrations" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  const isAdmin = session?.user?.role === 'admin';

  return (
    <>
      <Header title="Integrations" />
      <div className="p-6 space-y-6 max-w-4xl">
        {/* Info banner for non-admins */}
        {!isAdmin && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Integration settings can only be managed by organization admins.
          </div>
        )}

        {/* Slack */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messaging</CardTitle>
          </CardHeader>
          <CardContent>
            <SlackSection />
          </CardContent>
        </Card>

        {/* Webhooks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outbound Webhooks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">
              Register URLs to receive HTTP POST notifications when events occur in your
              organization. Optionally add a secret to verify requests with HMAC-SHA256.
            </p>
            <WebhookList />
          </CardContent>
        </Card>

        {/* Supported events reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supported Events</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-4 font-medium text-slate-700">Event</th>
                  <th className="text-left py-2 font-medium text-slate-700">Triggered when</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[
                  { event: 'clock.in',            when: 'An employee clocks in' },
                  { event: 'clock.out',           when: 'An employee clocks out' },
                  { event: 'timesheet.submitted', when: 'An employee submits a timesheet for approval' },
                  { event: 'timesheet.approved',  when: 'A manager approves a timesheet' },
                  { event: 'task.status_changed', when: 'A task is moved to a new status' },
                ].map(({ event, when }) => (
                  <tr key={event}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700">{event}</td>
                    <td className="py-2 text-slate-500">{when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
