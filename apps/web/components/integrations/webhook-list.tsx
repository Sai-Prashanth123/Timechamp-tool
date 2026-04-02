'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WebhookForm } from './webhook-form';
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useDeliveries,
  type WebhookEndpoint,
} from '@/hooks/use-integrations';

function DeliveryLog({ endpointId, onClose }: { endpointId: string; onClose: () => void }) {
  const { data: deliveries = [], isLoading } = useDeliveries(endpointId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delivery Log</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No deliveries yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Delivered At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                  <TableCell>
                    <Badge variant={d.succeeded ? 'default' : 'destructive'}>
                      {d.succeeded ? 'OK' : 'Failed'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">{d.statusCode ?? '\u2014'}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {d.deliveredAt
                      ? new Date(d.deliveredAt).toLocaleString()
                      : '\u2014'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WebhookList() {
  const { data: webhooks = [], isLoading } = useWebhooks();
  const createMutation = useCreateWebhook();
  const updateMutation = useUpdateWebhook();
  const deleteMutation = useDeleteWebhook();
  const testMutation = useTestWebhook();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [viewingDeliveriesFor, setViewingDeliveriesFor] = useState<string | null>(null);

  function handleCreate(data: any) {
    createMutation.mutate(data, { onSuccess: () => setShowForm(false) });
  }

  function handleUpdate(data: any) {
    if (!editing) return;
    updateMutation.mutate({ id: editing.id, ...data }, { onSuccess: () => setEditing(null) });
  }

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading webhooks...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">Webhook Endpoints</h3>
        <Button size="sm" onClick={() => setShowForm(true)}>
          + Add Endpoint
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <WebhookForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            isPending={createMutation.isPending}
          />
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <WebhookForm
            initial={editing}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            isPending={updateMutation.isPending}
          />
        </div>
      )}

      {/* Table */}
      {webhooks.length === 0 && !showForm ? (
        <p className="text-sm text-slate-400 py-4 text-center">
          No webhook endpoints registered yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((wh) => (
              <TableRow key={wh.id}>
                <TableCell className="font-mono text-xs max-w-xs truncate">
                  {wh.url}
                </TableCell>
                <TableCell>
                  {wh.events.length === 0 ? (
                    <Badge variant="secondary">All events</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {wh.events.map((ev) => (
                        <Badge key={ev} variant="outline" className="text-xs">
                          {ev}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={wh.isActive ? 'default' : 'secondary'}>
                    {wh.isActive ? 'Active' : 'Paused'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewingDeliveriesFor(wh.id)}
                    >
                      Log
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={testMutation.isPending}
                      onClick={() => testMutation.mutate(wh.id)}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(wh)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(wh.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Delivery log dialog */}
      {viewingDeliveriesFor && (
        <DeliveryLog
          endpointId={viewingDeliveriesFor}
          onClose={() => setViewingDeliveriesFor(null)}
        />
      )}
    </div>
  );
}
