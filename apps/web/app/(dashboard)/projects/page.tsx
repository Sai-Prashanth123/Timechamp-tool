'use client';

import { Header } from '@/components/dashboard/header';
import { ProjectList, CreateProjectDialog } from '@/components/projects/project-list';

export default function ProjectsPage() {
  return (
    <>
      <Header title="Projects" />
      <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">All Projects</h2>
            <p className="text-sm text-muted-foreground">
              Manage projects, tasks, and milestones for your team.
            </p>
          </div>
          <CreateProjectDialog />
        </div>
        <ProjectList />
      </div>
    </>
  );
}
