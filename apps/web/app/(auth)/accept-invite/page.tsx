import { Suspense } from 'react';
import { AcceptInviteForm } from '@/components/auth/accept-invite-form';

export const metadata = { title: 'Accept invitation — TimeChamp' };

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Accept your invitation</h1>
          <p className="mt-2 text-sm text-slate-500">
            Set up your account to get started
          </p>
        </div>
        <Suspense fallback={<div className="text-center text-slate-400 text-sm">Loading...</div>}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </div>
  );
}
