'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useUpdateMilestone,
  useCreateMilestone,
  useDeleteMilestone,
  type Milestone,
} from '@/hooks/use-projects';
import { CheckCircle, Circle, Plus, Trash2 } from 'lucide-react';

function MilestoneItem({
  milestone,
  projectId,
}: {
  milestone: Milestone;
  projectId: string;
}) {
  const updateMilestone = useUpdateMilestone(projectId);
  const deleteMilestone = useDeleteMilestone(projectId);
  const isComplete = !!milestone.completedAt;

  const toggleComplete = () => {
    updateMilestone.mutate({
      id: milestone.id,
      markComplete: !isComplete,
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b last:border-0">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <button
          onClick={toggleComplete}
          disabled={updateMilestone.isPending}
          className="mt-0.5 shrink-0 text-primary hover:opacity-70 transition-opacity"
          aria-label={isComplete ? 'Mark milestone incomplete' : 'Mark milestone complete'}
        >
          {isComplete ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium truncate ${
              isComplete ? 'line-through text-muted-foreground' : ''
            }`}
          >
            {milestone.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {milestone.dueDate && (
              <span className="text-xs text-muted-foreground">
                Due: {new Date(milestone.dueDate).toLocaleDateString()}
              </span>
            )}
            {isComplete && milestone.completedAt && (
              <Badge variant="secondary" className="text-xs">
                Completed {new Date(milestone.completedAt).toLocaleDateString()}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
        onClick={() => deleteMilestone.mutate(milestone.id)}
        aria-label="Delete milestone"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CreateMilestoneDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const createMilestone = useCreateMilestone(projectId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMilestone.mutate(
      { name: name.trim(), dueDate: dueDate || undefined },
      {
        onSuccess: () => {
          setOpen(false);
          setName('');
          setDueDate('');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1 h-4 w-4" />
          Add Milestone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Milestone</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="ms-name">Name</Label>
            <Input
              id="ms-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Beta Launch"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ms-due">Due Date</Label>
            <Input
              id="ms-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMilestone.isPending}>
              {createMilestone.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface MilestoneListProps {
  milestones: Milestone[];
  projectId: string;
}

export function MilestoneList({ milestones, projectId }: MilestoneListProps) {
  const pending = milestones.filter((m) => !m.completedAt);
  const completed = milestones.filter((m) => !!m.completedAt);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Milestones
          <span className="ml-2 text-muted-foreground font-normal">
            {completed.length}/{milestones.length} complete
          </span>
        </h3>
        <CreateMilestoneDialog projectId={projectId} />
      </div>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No milestones yet. Add one to track key deliverables.
        </p>
      ) : (
        <div>
          {[...pending, ...completed].map((ms) => (
            <MilestoneItem key={ms.id} milestone={ms} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
