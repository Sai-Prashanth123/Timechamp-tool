'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useSlackConfig,
  useSaveSlack,
  useDeleteSlack,
  useTestSlack,
} from '@/hooks/use-integrations';

export function SlackSection() {
  const { data: config, isLoading } = useSlackConfig();
  const saveMutation = useSaveSlack();
  const deleteMutation = useDeleteSlack();
  const testMutation = useTestSlack();

  const [editing, setEditing] = useState(false);
  const [inputUrl, setInputUrl] = useState('');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate(inputUrl.trim(), {
      onSuccess: () => {
        setEditing(false);
        setInputUrl('');
      },
    });
  }

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading Slack config...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Slack "S" wordmark placeholder */}
        <div className="h-8 w-8 rounded bg-[#4A154B] flex items-center justify-center text-white font-bold text-sm">
          S
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-800">Slack</h3>
          <p className="text-sm text-slate-500">
            Receive notifications in a Slack channel via an Incoming Webhook URL.
          </p>
        </div>
        {config && (
          <Badge className="ml-auto" variant={config.isActive ? 'default' : 'secondary'}>
            {config.isActive ? 'Connected' : 'Inactive'}
          </Badge>
        )}
      </div>

      {/* Current config display */}
      {config && !editing && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">
              Webhook URL
            </span>
            <span className="font-mono text-sm text-slate-700">{config.maskedUrl}</span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Update URL
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? 'Sending...' : 'Send Test'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-700 ml-auto"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </div>
        </div>
      )}

      {/* Add / edit form */}
      {(!config || editing) && (
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="slack-url">Slack Incoming Webhook URL</Label>
            <Input
              id="slack-url"
              type="url"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              required
              className="font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              Create an Incoming Webhook in your Slack App settings and paste the URL here.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            {editing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setInputUrl('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
