'use client';

import { useState } from 'react';
import {
  useGeofences,
  useCreateGeofence,
  useUpdateGeofence,
  useDeleteGeofence,
  type Geofence,
  type CreateGeofencePayload,
} from '@/hooks/use-gps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ── Inline form for create / edit ──────────────────────────────────────

type GeofenceFormValues = {
  name: string;
  lat: string;
  lng: string;
  radiusMeters: string;
  autoClockIn: boolean;
  autoClockOut: boolean;
  isActive: boolean;
};

const emptyForm: GeofenceFormValues = {
  name: '',
  lat: '',
  lng: '',
  radiusMeters: '100',
  autoClockIn: false,
  autoClockOut: false,
  isActive: true,
};

function geofenceToForm(g: Geofence): GeofenceFormValues {
  return {
    name: g.name,
    lat: String(g.lat),
    lng: String(g.lng),
    radiusMeters: String(g.radiusMeters),
    autoClockIn: g.autoClockIn,
    autoClockOut: g.autoClockOut,
    isActive: g.isActive,
  };
}

function GeofenceForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: GeofenceFormValues;
  onSave: (v: GeofenceFormValues) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [values, setValues] = useState<GeofenceFormValues>(initial);

  function set(field: keyof GeofenceFormValues, value: string | boolean) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(values);
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b bg-slate-50">
      <div className="col-span-2 md:col-span-1 flex flex-col gap-1">
        <Label htmlFor="gf-name" className="text-xs">Name *</Label>
        <Input
          id="gf-name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="HQ Office"
          required
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="gf-lat" className="text-xs">Latitude *</Label>
        <Input
          id="gf-lat"
          type="number"
          step="any"
          value={values.lat}
          onChange={(e) => set('lat', e.target.value)}
          placeholder="12.9716"
          required
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="gf-lng" className="text-xs">Longitude *</Label>
        <Input
          id="gf-lng"
          type="number"
          step="any"
          value={values.lng}
          onChange={(e) => set('lng', e.target.value)}
          placeholder="77.5946"
          required
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="gf-radius" className="text-xs">Radius (m) *</Label>
        <Input
          id="gf-radius"
          type="number"
          min={10}
          max={50000}
          value={values.radiusMeters}
          onChange={(e) => set('radiusMeters', e.target.value)}
          required
          className="h-8 text-sm"
        />
      </div>
      <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={values.autoClockIn}
            onChange={(e) => set('autoClockIn', e.target.checked)}
            className="accent-blue-600"
          />
          Auto clock-in
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={values.autoClockOut}
            onChange={(e) => set('autoClockOut', e.target.checked)}
            className="accent-blue-600"
          />
          Auto clock-out
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={values.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="accent-blue-600"
          />
          Active
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function GeofenceManager() {
  const { data: geofences = [], isLoading } = useGeofences();
  const createMutation = useCreateGeofence();
  const updateMutation = useUpdateGeofence();
  const deleteMutation = useDeleteGeofence();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleCreate(values: GeofenceFormValues) {
    const payload: CreateGeofencePayload = {
      name: values.name,
      lat: parseFloat(values.lat),
      lng: parseFloat(values.lng),
      radiusMeters: parseInt(values.radiusMeters, 10),
      autoClockIn: values.autoClockIn,
      autoClockOut: values.autoClockOut,
    };
    createMutation.mutate(payload, {
      onSuccess: () => setShowCreate(false),
    });
  }

  function handleUpdate(id: string, values: GeofenceFormValues) {
    updateMutation.mutate(
      {
        id,
        payload: {
          name: values.name,
          lat: parseFloat(values.lat),
          lng: parseFloat(values.lng),
          radiusMeters: parseInt(values.radiusMeters, 10),
          autoClockIn: values.autoClockIn,
          autoClockOut: values.autoClockOut,
          isActive: values.isActive,
        },
      },
      { onSuccess: () => setEditingId(null) },
    );
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this geofence?')) return;
    deleteMutation.mutate(id);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Geofences</CardTitle>
        {!showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + New Geofence
          </Button>
        )}
      </CardHeader>

      {showCreate && (
        <GeofenceForm
          initial={emptyForm}
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          saving={createMutation.isPending}
        />
      )}

      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-slate-400">Loading geofences...</div>
        ) : geofences.length === 0 && !showCreate ? (
          <div className="py-10 text-center text-sm text-slate-400">
            No geofences configured. Create one to enable auto clock-in/out.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Name</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Center (lat, lng)</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Radius (m)</th>
                  <th className="text-center px-4 py-2 font-medium text-slate-600">Auto In</th>
                  <th className="text-center px-4 py-2 font-medium text-slate-600">Auto Out</th>
                  <th className="text-center px-4 py-2 font-medium text-slate-600">Active</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {geofences.map((fence: Geofence) =>
                  editingId === fence.id ? (
                    <tr key={fence.id}>
                      <td colSpan={7} className="p-0">
                        <GeofenceForm
                          initial={geofenceToForm(fence)}
                          onSave={(v) => handleUpdate(fence.id, v)}
                          onCancel={() => setEditingId(null)}
                          saving={updateMutation.isPending}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={fence.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 text-slate-800 font-medium">{fence.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-500 text-xs">
                        {Number(fence.lat).toFixed(6)}, {Number(fence.lng).toFixed(6)}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">{fence.radiusMeters}</td>
                      <td className="px-4 py-2 text-center">
                        {fence.autoClockIn ? (
                          <span className="text-green-600 font-semibold">Yes</span>
                        ) : (
                          <span className="text-slate-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {fence.autoClockOut ? (
                          <span className="text-green-600 font-semibold">Yes</span>
                        ) : (
                          <span className="text-slate-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            fence.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {fence.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(fence.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDelete(fence.id)}
                            disabled={deleteMutation.isPending}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
