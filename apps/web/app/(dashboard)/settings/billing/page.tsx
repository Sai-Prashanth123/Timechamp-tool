'use client';

import { Header } from '@/components/dashboard/header';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSubscription, useInvoices, useCheckout, useUsers } from '@/hooks/use-organization';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700',
  canceled: 'bg-slate-100 text-slate-600',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  trialing: 'Free Trial',
  past_due: 'Payment due',
  canceled: 'Canceled',
};

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default function BillingPage() {
  const { data: sub, isLoading: subLoading } = useSubscription();
  const { data: invoices = [], isLoading: invLoading } = useInvoices();
  const { data: users = [] } = useUsers();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const openPortal = async () => {
    setIsRedirecting(true);
    try {
      const { data } = await api.post('/billing/portal');
      window.location.href = data.data.url;
    } catch {
      toast.error('Failed to open billing portal. Please try again.');
      setIsRedirecting(false);
    }
  };

  const activeUserCount = users.filter((u: { isActive: boolean }) => u.isActive).length;
  const seatUsagePct = sub?.seats ? Math.min(100, (activeUserCount / sub.seats) * 100) : 0;

  return (
    <>
      <Header title="Billing" />
      <div className="p-6 max-w-3xl space-y-6">

        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Manage your plan, seats, and payment details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {subLoading ? (
              <p className="text-slate-500 text-sm">Loading subscription...</p>
            ) : sub ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800 capitalize text-lg">
                      {sub.plan ?? 'Starter'} Plan
                    </p>
                    {sub.currentPeriodEnd && (
                      <p className="text-sm text-slate-500 mt-0.5">
                        {sub.status === 'canceled' ? 'Access ends' : 'Renews'}{' '}
                        {new Date(sub.currentPeriodEnd).toLocaleDateString(
                          undefined,
                          { year: 'numeric', month: 'long', day: 'numeric' },
                        )}
                      </p>
                    )}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[sub.status] ?? ''}`}>
                    {statusLabels[sub.status] ?? sub.status}
                  </span>
                </div>

                <div>
                  <div className="flex justify-between text-sm text-slate-600 mb-1.5">
                    <span>Seats used</span>
                    <span className="font-medium">{activeUserCount} / {sub.seats}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        seatUsagePct >= 90 ? 'bg-red-400' :
                        seatUsagePct >= 75 ? 'bg-amber-400' : 'bg-blue-500'
                      }`}
                      style={{ width: `${seatUsagePct}%` }}
                    />
                  </div>
                  {seatUsagePct >= 90 && (
                    <p className="text-xs text-red-600 mt-1">
                      Almost at seat limit — upgrade your plan to invite more team members.
                    </p>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {sub.stripeSubscriptionId ? (
                    <Button variant="outline" onClick={openPortal} disabled={isRedirecting}>
                      {isRedirecting ? 'Redirecting...' : 'Manage billing & invoices'}
                    </Button>
                  ) : (
                    <Button onClick={() => router.push('/onboarding/plan')}>Choose a plan</Button>
                  )}
                  {sub.status === 'active' && (
                    <Button variant="outline" onClick={() => router.push('/onboarding/plan')}>Upgrade plan</Button>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">No subscription found.</p>
                <Button onClick={() => router.push('/onboarding/plan')}>Choose a plan</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice History</CardTitle>
          </CardHeader>
          <CardContent>
            {invLoading ? (
              <p className="text-sm text-slate-400">Loading invoices...</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No invoices yet. They will appear here after your first payment.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Amount</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Download</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((inv: import('@/hooks/use-organization').Invoice) => (
                      <tr key={inv.id}>
                        <td className="py-2.5 pr-4 text-slate-700">
                          {new Date(inv.created * 1000).toLocaleDateString(
                            undefined,
                            { year: 'numeric', month: 'short', day: 'numeric' },
                          )}
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-slate-800">
                          {formatAmount(inv.amount, inv.currency)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {inv.status ?? 'unknown'}
                          </span>
                        </td>
                        <td className="py-2.5">
                          {inv.invoicePdf && (
                            <a
                              href={inv.invoicePdf}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              PDF
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
