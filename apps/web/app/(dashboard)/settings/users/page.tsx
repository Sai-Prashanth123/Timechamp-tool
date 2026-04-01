'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUsers, useInviteUser } from '@/hooks/use-organization';

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  role: z.enum(['admin', 'manager', 'employee']),
});

type InviteData = z.infer<typeof inviteSchema>;

const roleColors: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  employee: 'bg-green-100 text-green-700',
};

export default function UsersSettingsPage() {
  const { data: users = [], isLoading } = useUsers();
  const { mutate: invite, isPending } = useInviteUser();
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'employee' },
  });

  const onInvite = (data: InviteData) => {
    invite(data, {
      onSuccess: () => {
        reset();
        setShowForm(false);
      },
    });
  };

  return (
    <>
      <Header title="Users" />
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-slate-800">
            Team members
            {users.length > 0 && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({users.length})
              </span>
            )}
          </h3>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Invite user'}
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite team member</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleSubmit(onInvite)}
                className="flex flex-col sm:flex-row gap-4 items-start sm:items-end"
              >
                <div className="flex-1 space-y-2">
                  <Label>Email address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@company.com"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-sm text-red-500">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('role')}
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button type="submit" disabled={isPending}>
                  {isPending ? 'Sending...' : 'Send invite'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-slate-500">
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                No users yet. Invite your first team member.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-slate-50">
                    <tr>
                      <th className="text-left p-4 text-sm font-medium text-slate-600">
                        Name
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-slate-600">
                        Email
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-slate-600">
                        Role
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-slate-600">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b last:border-0 hover:bg-slate-50 transition-colors"
                      >
                        <td className="p-4 text-sm font-medium text-slate-800">
                          {user.firstName && user.lastName
                            ? `${user.firstName} ${user.lastName}`
                            : '—'}
                        </td>
                        <td className="p-4 text-sm text-slate-600">
                          {user.email}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${roleColors[user.role] ?? ''}`}
                          >
                            {user.role}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={`text-xs font-medium ${user.isActive ? 'text-green-600' : 'text-slate-400'}`}
                          >
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
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
