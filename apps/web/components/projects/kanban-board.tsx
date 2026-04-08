'use client';

import { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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
import { Plus } from 'lucide-react';
import type { Task, TaskPriority } from '@/hooks/use-projects';
import { useMoveTask, useCreateTask } from '@/hooks/use-projects';

const COLUMNS = [
  { id: 'todo',        label: 'To Do',       color: 'bg-slate-100 text-slate-600' },
  { id: 'in_progress', label: 'In Progress',  color: 'bg-blue-100 text-blue-700' },
  { id: 'in_review',   label: 'In Review',    color: 'bg-amber-100 text-amber-700' },
  { id: 'done',        label: 'Done',         color: 'bg-green-100 text-green-700' },
];

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-slate-100 text-slate-600',
  urgent: 'bg-red-200 text-red-800',
};

function TaskCard({ task, onSelect }: { task: Task; onSelect: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(task)}
      className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing transition-shadow"
    >
      <p className="text-sm font-medium text-slate-800 leading-snug mb-2">{task.title}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {task.priority && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${PRIORITY_COLORS[task.priority] ?? 'bg-slate-100 text-slate-600'}`}>
            {task.priority}
          </span>
        )}
        {task.dueDate && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isOverdue ? 'bg-red-100 text-red-600 font-semibold' : 'bg-slate-50 text-slate-500'}`}>
            {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
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
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
  onSelectTask?: (task: Task) => void;
}

export function KanbanBoard({ tasks, projectId, onSelectTask }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const moveTask = useMoveTask(projectId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const tasksByColumn = (colId: string) =>
    tasks
      .filter((t) => t.status === colId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  function handleDragStart(event: any) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const draggedTask = tasks.find((t) => t.id === active.id);
    if (!draggedTask) return;

    // Determine target column
    const overCol = COLUMNS.find((c) => c.id === over.id);
    const overTask = tasks.find((t) => t.id === over.id);
    const targetStatus = overCol?.id ?? overTask?.status ?? draggedTask.status;

    const colTasks = tasksByColumn(targetStatus).filter((t) => t.id !== draggedTask.id);
    let targetIdx = colTasks.length; // append at end

    if (overTask && overTask.status === targetStatus) {
      targetIdx = colTasks.findIndex((t) => t.id === overTask.id);
      if (targetIdx === -1) targetIdx = colTasks.length;
    }

    if (draggedTask.status === targetStatus && draggedTask.position === targetIdx) return;

    moveTask.mutate({ taskId: draggedTask.id, status: targetStatus, position: targetIdx });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateTaskDialog projectId={projectId} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const colTasks = tasksByColumn(col.id);
            return (
              <div key={col.id} className="flex flex-col bg-slate-50 rounded-xl p-3 min-h-[200px]">
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${col.color}`}>
                    {col.label}
                  </span>
                  <span className="text-xs text-slate-400 ml-auto">{colTasks.length}</span>
                </div>

                {/* Droppable area */}
                <SortableContext items={colTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2 flex-1">
                    {colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onSelect={onSelectTask ?? (() => {})}
                      />
                    ))}
                    {colTasks.length === 0 && (
                      <div className="flex-1 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-400 py-6">
                        Drop here
                      </div>
                    )}
                  </div>
                </SortableContext>
              </div>
            );
          })}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="bg-white rounded-lg border border-blue-400 p-3 shadow-xl rotate-2 text-sm font-medium text-slate-800 max-w-[200px]">
              {activeTask.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
