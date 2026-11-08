import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { forgotPasswordSchema, loginSchema, passwordSchema, registerSchema, type LoginInput, type RegisterInput } from '@qtm/shared';
import { Field } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { meQueryKey } from './session';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="font-semibold tracking-tight">QA Testing Manager</span>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-xl backdrop-blur">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">{subtitle}</p>
          {children}
        </div>
        {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
      </div>
    </main>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {errorMessage(error)}
    </p>
  );
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  // On success the refreshed session makes GuestOnly redirect (to the originally requested page).
  const login = useMutation({
    mutationFn: (values: LoginInput) => api.post('/auth/login', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
  const { errors } = form.formState;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Sign in to your workspace."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
        <FormError error={login.error} />
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register('password')} />
        </Field>
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const queryClient = useQueryClient();
  const form = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });
  const register = useMutation({
    mutationFn: (values: RegisterInput) => api.post('/auth/register', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
  const { errors } = form.formState;

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Start managing test cases, runs and bugs in minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => register.mutate(v))} noValidate>
        <FormError error={register.error} />
        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 12 characters with upper, lower case and a number.">
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register('password')} />
        </Field>
        <Field label="Organization name" htmlFor="organizationName" error={errors.organizationName?.message}>
          <Input id="organizationName" aria-invalid={!!errors.organizationName} {...form.register('organizationName')} />
        </Field>
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending && <Loader2 className="animate-spin" />} Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const form = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema) });
  const forgot = useMutation({ mutationFn: (v: { email: string }) => api.post('/auth/forgot-password', v) });
  return (
    <AuthShell title="Reset password" subtitle="We will email you a link to choose a new password." footer={<Link to="/login" className="text-primary hover:underline">Back to sign in</Link>}>
      {forgot.isSuccess ? (
        <p className="flex gap-2 text-sm" role="status">
          <CheckCircle2 className="size-5 shrink-0 text-success" /> If an account exists for this email, a reset link has been sent.
        </p>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => forgot.mutate(v))} noValidate>
          <FormError error={forgot.error} />
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" disabled={forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

const resetFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof resetFormSchema>>({ resolver: zodResolver(resetFormSchema) });
  const reset = useMutation({
    mutationFn: (v: { password: string }) => api.post('/auth/reset-password', { token, password: v.password }),
    onSuccess: () => setDone(true),
  });
  const { errors } = form.formState;
  return (
    <AuthShell title="Choose a new password" subtitle="All other sessions will be signed out." footer={<Link to="/login" className="text-primary hover:underline">Back to sign in</Link>}>
      {done ? (
        <p className="flex gap-2 text-sm" role="status">
          <CheckCircle2 className="size-5 shrink-0 text-success" /> Password updated. You can now sign in.
        </p>
      ) : !token ? (
        <p className="text-sm text-destructive">This reset link is missing its token.</p>
      ) : (
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => reset.mutate(v))} noValidate>
          <FormError error={reset.error} />
          <Field label="New password" htmlFor="password" error={errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" disabled={reset.isPending}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
