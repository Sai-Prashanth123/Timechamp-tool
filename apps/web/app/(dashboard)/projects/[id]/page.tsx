'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { KanbanBoard } from '@/components/projects/kanban-board';
import { MilestoneList } from '@/components/projects/milestone-list';
import { TaskDetailDrawer } from '@/components/projects/task-detail-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProject, type ProjectStatus, type Task } from '@/hooks/use-projects';
import { ArrowLeft, CalendarDays, LayoutGrid, List } from 'lucide-react';

const STATUS_VARIANT: Record<
  ProjectStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  completed: 'secondary',
  on_hold: 'outline',
  archived: 'destructive',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, isError } = useProject(id);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<'board' | 'list'>('board');

  if (isLoading) {
    return (
      <>
        <Header title="Project" />
        <div className="p-6 space-y-6 max-w-7xl">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        <Header title="Project" />
        <div className="p-6 text-center text-muted-foreground">
          <p>Project not found or you don&apos;t have access.</p>
          <Button
            variant="link"
            onClick={() => router.push('/projects')}
            className="mt-2"
          >
            Back to Projects
          </Button>
        </div>
      </>
    );
  }

  const { project, tasks, milestones } = data;
  const doneTasks = tasks.filter((t) => t.status === 'done').length;

  return (
    <>
      <Header title={project.name} />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Back + project header */}
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5"
            onClick={() => router.push('/projects')}
            aria-label="Back to projects"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold truncate">{project.name}</h1>
              <Badge
                variant={STATUS_VARIANT[project.status]}
                className="capitalize"
              >
                {project.status.replace('_', ' ')}
              </Badge>
            </div>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {project.description}
              </p>
            )}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span>
                {doneTasks} / {tasks.length} tasks done
              </span>
              {project.deadline && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Deadline: {new Date(project.deadline).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'board' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('board')}
            className="gap-1.5"
          >
            <LayoutGrid className="h-4 w-4" />
            Board
          </Button>
          <Button
            variant={activeTab === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('list')}
            className="gap-1.5"
          >
            <List className="h-4 w-4" />
            List
          </Button>
        </div>

        {/* Kanban board / List */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{activeTab === 'board' ? 'Task Board' : 'Task List'}</CardTitle>
          </CardHeader>
          <CardContent>
            {activeTab === 'board' ? (
              <KanbanBoard tasks={tasks} projectId={id} onSelectTask={(t) => setSelectedTask(t)} />
            ) : (
              <div className="divide-y divide-slate-100">
                {tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No tasks yet.</p>
                ) : (
                  tasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTask(t)}
                      className="w-full text-left px-3 py-3 hover:bg-slate-50 transition-colors flex items-center gap-3"
                    >
                      <span className="flex-1 text-sm font-medium text-slate-800 truncate">{t.title}</span>
                      <span className="text-[10px] capitalize text-slate-500">{t.status.replace(/_/g, ' ')}</span>
                      {t.priority && (
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {t.priority}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <TaskDetailDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />

        {/* Milestones */}
        <Card>
          <CardContent className="pt-5">
            <MilestoneList milestones={milestones} projectId={id} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
