'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrganization, useUpdateOrganization } from '@/hooks/use-organization';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  timezone: z.string().optional(),
  website: z
    .string()
    .url('Must be a valid URL (include https://)')
    .optional()
    .or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

export default function OrganizationSettingsPage() {
  const { data: org, isLoading } = useOrganization();
  const { mutate: update, isPending } = useUpdateOrganization();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (org) {
      reset({
        name: org.name,
        timezone: org.timezone ?? '',
        website: org.website ?? '',
      });
    }
  }, [org, reset]);

  const onSubmit = (data: FormData) => {
    update({
      name: data.name,
      timezone: data.timezone || undefined,
      website: data.website || undefined,
    });
  };

  if (isLoading) {
    return (
      <>
        <Header title="Organization Settings" />
        <div className="p-6 text-slate-500">Loading...</div>
      </>
    );
  }

  return (
    <>
      <Header title="Organization Settings" />
      <div className="p-6 max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Organization details</CardTitle>
            <CardDescription>
              Update your organization name and basic information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Organization name</Label>
                <Input id="name" {...register('name')} />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  placeholder="UTC"
                  {...register('timezone')}
                />
                <p className="text-xs text-slate-500">
                  e.g. America/New_York, Europe/London, Asia/Kolkata
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  placeholder="https://yourcompany.com"
                  {...register('website')}
                />
                {errors.website && (
                  <p className="text-sm text-red-500">
                    {errors.website.message}
                  </p>
                )}
              </div>

              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {org && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Current plan</p>
                  <p className="font-medium capitalize">{org.plan}</p>
                </div>
                <div>
                  <p className="text-slate-500">Seats</p>
                  <p className="font-medium">{org.seats}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
