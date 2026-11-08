import '@fontsource-variable/inter';
import './index.css';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { meQueryKey } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { ThemeProvider } from '@/lib/theme';
import { router } from './router';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    // An expired session surfaces as 401 on any mutation: send the user back to login.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(meQueryKey, null);
    },
  }),
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
