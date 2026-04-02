'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useUpdateTask,
  useCreateTask,
  useDeleteTask,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '@/hooks/use-projects';
import { ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react';

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'done', label: 'Done' },
];

const PRIORITY_VARIANT: Record<
  TaskPriority,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  low: 'secondary',
  medium: 'outline',
  high: 'default',
  urgent: 'destructive',
};

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

function TaskCard({
  task,
  projectId,
}: {
  task: Task;
  projectId: string;
}) {
  const updateTask = useUpdateTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const currentIndex = STATUS_ORDER.indexOf(task.status);

  const movePrev = () => {
    if (currentIndex <= 0) return;
    updateTask.mutate({ id: task.id, status: STATUS_ORDER[currentIndex - 1] });
  };

  const moveNext = () => {
    if (currentIndex >= STATUS_ORDER.length - 1) return;
    updateTask.mutate({ id: task.id, status: STATUS_ORDER[currentIndex + 1] });
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{task.title}</p>
          <Badge
            variant={PRIORITY_VARIANT[task.priority]}
            className="shrink-0 text-xs capitalize"
          >
            {task.priority}
          </Badge>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {task.description}
          </p>
        )}
        {task.assigneeId && (
          <p className="text-xs text-muted-foreground">
            Assignee: <span className="font-mono">{task.assigneeId.slice(0, 8)}</span>
          </p>
        )}
        {task.dueDate && (
          <p className="text-xs text-muted-foreground">
            Due: {new Date(task.dueDate).toLocaleDateString()}
          </p>
        )}
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={movePrev}
              disabled={currentIndex <= 0 || updateTask.isPending}
              aria-label="Move task to previous status"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={moveNext}
              disabled={
                currentIndex >= STATUS_ORDER.length - 1 || updateTask.isPending
              }
              aria-label="Move task to next status"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            onClick={() => deleteTask.mutate(task.id)}
            aria-label="Delete task"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateTaskDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');
  const createTask = useCreateTask(projectId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
        dueDate: dueDate || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle('');
          setDescription('');
          setPriority('medium');
          setEstimatedHours('');
          setDueDate('');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Design homepage mockup"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-desc">Description</Label>
            <Input
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
              >
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-hours">Est. Hours</Label>
              <Input
                id="task-hours"
                type="number"
                min="0"
                step="0.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="4.5"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-due">Due Date</Label>
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createTask.isPending}>
              {createTask.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface KanbanBoardProps {
  tasks: Task[];
  projectId: string;
}

export function KanbanBoard({ tasks, projectId }: KanbanBoardProps) {
  const grouped = COLUMNS.reduce<Record<TaskStatus, Task[]>>(
    (acc, col) => {
      acc[col.key] = tasks.filter((t) => t.status === col.key);
      return acc;
    },
    { todo: [], in_progress: [], in_review: [], done: [] },
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateTaskDialog projectId={projectId} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <div key={col.key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">
                {col.label}
              </h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {grouped[col.key].length}
              </span>
            </div>
            <div className="flex flex-col gap-2 min-h-[120px] bg-muted/30 rounded-lg p-2">
              {grouped[col.key].length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No tasks
                </p>
              ) : (
                grouped[col.key].map((task) => (
                  <TaskCard key={task.id} task={task} projectId={projectId} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
