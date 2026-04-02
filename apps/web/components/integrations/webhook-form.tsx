'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ALL_WEBHOOK_EVENTS,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookEndpoint,
} from '@/hooks/use-integrations';

type Props = {
  initial?: WebhookEndpoint;
  onSubmit: (data: CreateWebhookInput | UpdateWebhookInput) => void;
  onCancel: () => void;
  isPending: boolean;
};

export function WebhookForm({ initial, onSubmit, onCancel, isPending }: Props) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [secret, setSecret] = useState(initial?.secret ?? '');
  const [events, setEvents] = useState<string[]>(initial?.events ?? []);

  function toggleEvent(value: string) {
    setEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      url: url.trim(),
      secret: secret.trim() || undefined,
      events,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="webhook-url">Endpoint URL</Label>
        <Input
          id="webhook-url"
          type="url"
          placeholder="https://example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="webhook-secret">
          Secret{' '}
          <span className="text-slate-400 font-normal">(optional -- used for HMAC-SHA256 signature)</span>
        </Label>
        <Input
          id="webhook-secret"
          type="password"
          placeholder="Leave blank to skip signing"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">
          Events{' '}
          <span className="text-slate-400 font-normal">(leave all unchecked to receive every event)</span>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {ALL_WEBHOOK_EVENTS.map((ev) => (
            <div key={ev.value} className="flex items-center gap-2">
              <Checkbox
                id={`ev-${ev.value}`}
                checked={events.includes(ev.value)}
                onCheckedChange={() => toggleEvent(ev.value)}
              />
              <Label htmlFor={`ev-${ev.value}`} className="font-normal cursor-pointer">
                {ev.label}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isPending} className="flex-1">
          {isPending ? 'Saving...' : initial ? 'Update Webhook' : 'Create Webhook'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
