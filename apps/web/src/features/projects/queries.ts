import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Member, Project, Suite } from '@/lib/types';

export const keys = {
  projects: (orgId: string) => ['projects', orgId] as const,
  project: (projectId: string) => ['project', projectId] as const,
  suites: (projectId: string) => ['project', projectId, 'suites'] as const,
  members: (orgId: string) => ['members', orgId] as const,
};

export function useProjects(orgId: string) {
  return useQuery({
    queryKey: keys.projects(orgId),
    queryFn: () => api.get<{ items: Project[] }>(`/organizations/${orgId}/projects`).then((r) => r.items),
  });
}

export function useProject(projectId: string) {
  return useQuery({ queryKey: keys.project(projectId), queryFn: () => api.get<Project>(`/projects/${projectId}`) });
}

export function useSuites(projectId: string) {
  return useQuery({
    queryKey: keys.suites(projectId),
    queryFn: () => api.get<{ items: Suite[] }>(`/projects/${projectId}/suites`).then((r) => r.items),
  });
}

export function useOrgMembers(orgId: string) {
  return useQuery({
    queryKey: keys.members(orgId),
    queryFn: () => api.get<{ items: Member[] }>(`/organizations/${orgId}/members`).then((r) => r.items),
  });
}
