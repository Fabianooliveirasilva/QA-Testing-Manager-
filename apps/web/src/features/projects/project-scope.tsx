import { createContext, useContext } from 'react';
import { Outlet, useParams } from 'react-router';
import { ErrorState, LoadingRows } from '@/components/states';
import { useSyncProject } from '@/features/auth/session';
import type { Project } from '@/lib/types';
import { canManage, canWrite } from './permissions';
import { useProject } from './queries';

interface ProjectScope {
  project: Project;
  projectId: string;
  /** Caller may create/edit test artifacts (role allows it and project is not archived). */
  writable: boolean;
  manage: boolean;
  base: string;
}

const ScopeContext = createContext<ProjectScope | null>(null);

/** Layout route for /p/:projectId/* — loads the project once and shares it with child pages. */
export function ProjectScopeLayout() {
  const { projectId = '' } = useParams();
  useSyncProject(projectId);
  const { data: project, isPending, error, refetch } = useProject(projectId);
  if (isPending) return <LoadingRows rows={6} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const value: ProjectScope = {
    project,
    projectId,
    writable: canWrite(project.role) && project.status === 'ACTIVE',
    manage: canManage(project.role),
    base: `/p/${projectId}`,
  };
  return (
    <ScopeContext.Provider value={value}>
      {project.status === 'ARCHIVED' && (
        <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">This project is archived and read-only.</p>
      )}
      <Outlet />
    </ScopeContext.Provider>
  );
}

export function useProjectScope(): ProjectScope {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useProjectScope must be used under ProjectScopeLayout');
  return ctx;
}
