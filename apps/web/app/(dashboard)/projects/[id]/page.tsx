'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { KanbanBoard } from '@/components/projects/kanban-board';
import { MilestoneList } from '@/components/projects/milestone-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProject, type ProjectStatus } from '@/hooks/use-projects';
import { ArrowLeft, CalendarDays } from 'lucide-react';

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

        {/* Kanban board */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Task Board</CardTitle>
          </CardHeader>
          <CardContent>
            <KanbanBoard tasks={tasks} projectId={id} />
          </CardContent>
        </Card>

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
