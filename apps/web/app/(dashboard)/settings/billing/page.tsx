'use client';

import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/use-organization';
import api from '@/lib/api';
import { toast } from 'sonner';
import { useState } from 'react';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700',
  canceled: 'bg-slate-100 text-slate-600',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment due',
  canceled: 'Canceled',
};

export default function BillingPage() {
  const { data: sub, isLoading } = useSubscription();
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

  return (
    <>
      <Header title="Billing" />
      <div className="p-6 max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>
              Manage your plan, seats, and payment details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-slate-500 text-sm">Loading subscription...</p>
            ) : sub ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800 capitalize">
                      {sub.plan ?? 'Starter'} plan
                    </p>
                    <p className="text-sm text-slate-500">
                      {sub.seats} seat{sub.seats !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[sub.status] ?? ''}`}
                  >
                    {statusLabels[sub.status] ?? sub.status}
                  </span>
                </div>

                {sub.currentPeriodEnd && (
                  <p className="text-sm text-slate-500">
                    {sub.status === 'canceled' ? 'Access ends' : 'Renews'}{' '}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString(
                      undefined,
                      { year: 'numeric', month: 'long', day: 'numeric' },
                    )}
                  </p>
                )}

                {sub.stripeSubscriptionId ? (
                  <Button
                    variant="outline"
                    onClick={openPortal}
                    disabled={isRedirecting}
                  >
                    {isRedirecting
                      ? 'Redirecting...'
                      : 'Manage billing & invoices'}
                  </Button>
                ) : (
                  <p className="text-sm text-slate-500">
                    You are on a free trial. Add a payment method to continue
                    after the trial ends.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No subscription found for this organization.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
