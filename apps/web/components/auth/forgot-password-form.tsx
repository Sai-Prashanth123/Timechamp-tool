'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

type FormData = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email: data.email });
    } catch {
      // Always show success to prevent email enumeration
    } finally {
      setIsSubmitting(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-3">
          <p className="text-green-600 font-medium">Check your email</p>
          <p className="text-sm text-slate-500">
            If that email address is registered, you'll receive a password reset link shortly.
          </p>
          <a href="/login" className="text-sm text-blue-600 hover:underline">
            Back to login
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              placeholder="you@company.com"
            />
            {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send reset link'}
          </Button>
          <p className="text-center text-sm text-slate-500">
            Remember your password?{' '}
            <a href="/login" className="text-blue-600 hover:underline">
              Log in
            </a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
