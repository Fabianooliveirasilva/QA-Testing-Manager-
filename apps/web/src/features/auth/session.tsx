import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ApiError, api } from '@/lib/api';
import type { Me, Organization } from '@/lib/types';
import { FullPageSpinner } from '@/components/states';

export const meQueryKey = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

const ORG_KEY = 'qtm-org';
const projectKey = (orgId: string) => `qtm-project:${orgId}`;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Selection just won't persist across reloads.
  }
}

interface WorkspaceValue {
  me: Me;
  organization: Organization;
  setOrganizationId: (id: string) => void;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function WorkspaceProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [orgId, setOrgId] = useState(() => readStorage(ORG_KEY));
  const organization = me.organizations.find((o) => o.id === orgId) ?? me.organizations[0];
  const [projectId, setProjectIdState] = useState<string | null>(() =>
    organization ? readStorage(projectKey(organization.id)) : null,
  );
  const queryClient = useQueryClient();

  const setOrganizationId = useCallback(
    (id: string) => {
      writeStorage(ORG_KEY, id);
      setOrgId(id);
      setProjectIdState(readStorage(projectKey(id)));
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [queryClient],
  );

  const setProjectId = useCallback(
    (id: string | null) => {
      if (organization) writeStorage(projectKey(organization.id), id);
      setProjectIdState(id);
    },
    [organization],
  );

  const value = useMemo(
    () => (organization ? { me, organization, setOrganizationId, projectId, setProjectId } : null),
    [me, organization, setOrganizationId, projectId, setProjectId],
  );
  if (!value) return <p className="p-8 text-muted-foreground">Your account does not belong to any organization.</p>;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside an authenticated route');
  return ctx;
}

/** Route guard: renders children only for authenticated users. */
export function RequireAuth() {
  const { data: me, isPending, error } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageSpinner />;
  if (error) throw error;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <WorkspaceProvider me={me}>
      <Outlet />
    </WorkspaceProvider>
  );
}

/** Route guard for login/register: authenticated users go to the dashboard. */
export function GuestOnly() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageSpinner />;
  if (me) {
    // Return to the page that required authentication, if any.
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from?.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />;
  }
  return <Outlet />;
}

/** Keeps the selected project in sync with the project in the URL. */
export function useSyncProject(projectId: string | undefined) {
  const { projectId: current, setProjectId } = useWorkspace();
  useEffect(() => {
    if (projectId && projectId !== current) setProjectId(projectId);
  }, [projectId, current, setProjectId]);
}
