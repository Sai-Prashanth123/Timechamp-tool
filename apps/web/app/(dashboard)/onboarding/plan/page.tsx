'use client';

import React, { useState } from 'react';
import { Header } from '@/components/dashboard/header';
import { Button } from '@/components/ui/button';
import { useCheckout } from '@/hooks/use-organization';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 9,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER ?? '',
    maxSeats: 10,
    features: ['Employee monitoring', 'Time tracking', 'Screenshot capture', 'Email support'],
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 15,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO ?? '',
    maxSeats: 100,
    features: ['Everything in Starter', 'GPS & geofencing', 'Project & task management', 'Analytics & reports', 'Alerts', 'Priority support'],
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 25,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE ?? '',
    maxSeats: Infinity,
    features: ['Everything in Pro', 'Live screen streaming', 'Slack & Jira integrations', 'Webhooks API', 'Dedicated support'],
    highlight: false,
  },
] as const;

export default function PlanPickerPage() {
  const [selectedPlan, setSelectedPlan] = useState<string>('pro');
  const [seats, setSeats] = useState(5);
  const checkout = useCheckout();

  const plan = PLANS.find((p) => p.id === selectedPlan)!;

  const handleSubscribe = () => {
    if (!plan.priceId) {
      alert('Stripe price IDs are not configured. Set NEXT_PUBLIC_STRIPE_PRICE_* env vars.');
      return;
    }
    checkout.mutate({ priceId: plan.priceId, seats });
  };

  return (
    <>
      <Header title="Choose your plan" />
      <div className="flex-1 p-6 max-w-5xl space-y-8">

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">
            Start your workforce intelligence journey
          </h2>
          <p className="text-slate-500">14-day free trial · No credit card required · Cancel anytime</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPlan(p.id)}
              className={`relative rounded-xl border-2 p-6 text-left transition-all ${
                selectedPlan === p.id
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-semibold px-3 py-0.5 rounded-full">
                  Most popular
                </span>
              )}
              <div className="mb-4">
                <p className="text-lg font-bold text-slate-900">{p.name}</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">
                  ${p.price}
                  <span className="text-base font-normal text-slate-500">/user/mo</span>
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {p.maxSeats === Infinity ? 'Unlimited seats' : `Up to ${p.maxSeats} seats`}
                </p>
              </div>
              <ul className="space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-green-500 mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {selectedPlan === p.id && (
                <div className="absolute top-3 right-3 h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm max-w-sm mx-auto space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Number of seats</label>
            <p className="text-xs text-slate-400">Seats = number of employees to monitor</p>
            <div className="flex items-center gap-3 mt-2">
              <Button variant="outline" size="sm" onClick={() => setSeats(Math.max(1, seats - 1))}>−</Button>
              <input
                type="number"
                min={1}
                max={plan.maxSeats === Infinity ? 10000 : plan.maxSeats}
                value={seats}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSeats(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 text-center border border-slate-300 rounded-md py-1.5 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSeats(Math.min(plan.maxSeats === Infinity ? seats + 1 : plan.maxSeats, seats + 1))}
              >
                +
              </Button>
            </div>
          </div>

          <div className="border-t pt-3 space-y-1">
            <div className="flex justify-between text-sm text-slate-600">
              <span>{seats} × ${plan.price}/mo</span>
              <span className="font-medium">${seats * plan.price}/mo</span>
            </div>
            <p className="text-xs text-slate-400">Billed monthly · Cancel anytime</p>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={checkout.isPending}
            onClick={handleSubscribe}
          >
            {checkout.isPending ? 'Redirecting to Stripe...' : `Start ${plan.name} Trial`}
          </Button>
          <p className="text-center text-xs text-slate-400">
            14 days free · No credit card needed
          </p>
        </div>
      </div>
    </>
  );
}
