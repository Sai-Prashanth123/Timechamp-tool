'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { X } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

export function EmailVerificationBanner() {
  const { data: session } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);

  // Only show if user is authenticated and email is NOT verified
  const showBanner =
    !dismissed &&
    session?.user &&
    (session.user as any).emailVerified === false;

  const handleResend = async () => {
    setSending(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success('Verification email sent — check your inbox');
    } catch {
      toast.error('Failed to send verification email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!showBanner) return null;

  return (
    <div className="relative flex items-center justify-between gap-4 bg-amber-50 border-b border-amber-200 px-4 py-3">
      <p className="text-sm text-amber-800">
        <strong>Verify your email address</strong> — check your inbox for a verification link.{' '}
        <button
          onClick={handleResend}
          disabled={sending}
          className="underline hover:no-underline font-medium disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Resend email'}
        </button>
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-amber-600 hover:text-amber-900 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
