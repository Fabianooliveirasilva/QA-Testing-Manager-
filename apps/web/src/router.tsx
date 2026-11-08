import type { ComponentType } from 'react';
import { Compass } from 'lucide-react';
import { createBrowserRouter, Link, Navigate, useRouteError } from 'react-router';
import { EmptyState, ErrorState } from '@/components/states';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/features/auth/auth-pages';
import { GuestOnly, RequireAuth } from '@/features/auth/session';
import { ProjectScopeLayout } from '@/features/projects/project-scope';
import { AppLayout } from '@/layouts/app-layout';

/** Route-level code splitting: each feature module is loaded on first navigation. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

function NotFound() {
  return (
    <div className="py-16">
      <EmptyState icon={Compass} title="Page not found" description="The page you are looking for does not exist or you do not have access to it." action={<Link to="/" className="text-sm text-primary hover:underline">Back to dashboard</Link>} />
    </div>
  );
}

function RouteError() {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-lg p-8">
      <ErrorState error={error} onRetry={() => window.location.reload()} />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteError />,
            children: [
              { index: true, lazy: page(() => import('@/features/dashboard/dashboard-page'), 'DashboardPage') },
              { path: 'projects', lazy: page(() => import('@/features/projects/projects-pages'), 'ProjectsPage') },
              { path: 'projects/:projectId', lazy: page(() => import('@/features/projects/projects-pages'), 'ProjectDetailPage') },
              {
                path: 'p/:projectId',
                element: <ProjectScopeLayout />,
                children: [
                  { index: true, element: <Navigate to="test-cases" replace /> },
                  { path: 'test-cases', lazy: page(() => import('@/features/test-cases/test-cases-pages'), 'TestCasesPage') },
                  { path: 'test-cases/new', lazy: page(() => import('@/features/test-cases/test-cases-pages'), 'NewTestCasePage') },
                  { path: 'test-cases/:caseId', lazy: page(() => import('@/features/test-cases/test-cases-pages'), 'TestCaseDetailPage') },
                  { path: 'test-cases/:caseId/edit', lazy: page(() => import('@/features/test-cases/test-cases-pages'), 'EditTestCasePage') },
                  { path: 'test-plans', lazy: page(() => import('@/features/test-plans/test-plans-pages'), 'TestPlansPage') },
                  { path: 'test-plans/:planId', lazy: page(() => import('@/features/test-plans/test-plans-pages'), 'TestPlanDetailPage') },
                  { path: 'test-runs', lazy: page(() => import('@/features/test-runs/test-runs-pages'), 'TestRunsPage') },
                  { path: 'test-runs/:runId', lazy: page(() => import('@/features/test-runs/test-runs-pages'), 'TestRunDetailPage') },
                  { path: 'bugs', lazy: page(() => import('@/features/bugs/bugs-pages'), 'BugsPage') },
                  { path: 'bugs/new', lazy: page(() => import('@/features/bugs/bugs-pages'), 'NewBugPage') },
                  { path: 'bugs/:bugId', lazy: page(() => import('@/features/bugs/bugs-pages'), 'BugDetailPage') },
                  { path: 'automation', lazy: page(() => import('@/features/automation/automation-page'), 'AutomationPage') },
                ],
              },
              { path: 'ai', lazy: page(() => import('@/features/ai/ai-page'), 'AiPage') },
              { path: 'settings', lazy: page(() => import('@/features/settings/settings-page'), 'SettingsPage') },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
