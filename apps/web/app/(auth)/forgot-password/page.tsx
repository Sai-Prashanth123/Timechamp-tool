import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Forgot your password?</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter your email and we'll send you a reset link
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
