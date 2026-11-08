import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { changePasswordSchema, organizationCreateSchema, type OrgRole } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, PageHeader, Pagination, Panel } from '@/components/page';
import { LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { meQueryKey, useWorkspace } from '@/features/auth/session';
import { canManage } from '@/features/projects/permissions';
import { keys, useOrgMembers } from '@/features/projects/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import type { AuditEntry, Organization, Paginated } from '@/lib/types';

const ASSIGNABLE_ROLES: Exclude<OrgRole, 'OWNER'>[] = ['ADMIN', 'MEMBER', 'VIEWER'];

export function SettingsPage() {
  const { organization } = useWorkspace();
  const manage = canManage(organization.role);
  return (
    <>
      <PageHeader title="Settings" description={`Account and ${organization.name} organization settings`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PasswordPanel />
        <NewOrganizationPanel />
        {manage && <OrganizationPanel />}
        <MembersPanel manage={manage} />
        {manage && <AuditPanel />}
      </div>
    </>
  );
}

const passwordForm = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function PasswordPanel() {
  const form = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm) });
  const change = useMutation({
    mutationFn: (v: z.infer<typeof passwordForm>) => api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      form.reset();
      toast.success('Password changed. Other sessions were signed out.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const { errors } = form.formState;
  return (
    <Panel title="Change password">
      <form className="space-y-3" noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))}>
        <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword?.message}>
          <Input id="pw-current" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="pw-new" error={errors.newPassword?.message}>
          <Input id="pw-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirm?.message}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" disabled={change.isPending}>
          Update password
        </Button>
      </form>
    </Panel>
  );
}

function NewOrganizationPanel() {
  const { setOrganizationId } = useWorkspace();
  const queryClient = useQueryClient();
  const form = useForm<{ name: string }>({ resolver: zodResolver(organizationCreateSchema) });
  const create = useMutation({
    mutationFn: (v: { name: string }) => api.post<Organization>('/organizations', v),
    onSuccess: async (org) => {
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
      setOrganizationId(org.id);
      form.reset();
      toast.success(`Switched to ${org.name}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="New organization">
      <form className="flex gap-2" noValidate onSubmit={form.handleSubmit((v) => create.mutate(v))}>
        <Input placeholder="Organization name" aria-label="Organization name" {...form.register('name')} />
        <Button type="submit" variant="outline" disabled={create.isPending}>
          Create
        </Button>
      </form>
      {form.formState.errors.name && <p className="mt-1 text-xs text-destructive">{form.formState.errors.name.message}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Organizations are fully isolated workspaces with their own members and projects.</p>
    </Panel>
  );
}

function OrganizationPanel() {
  const { organization } = useWorkspace();
  const queryClient = useQueryClient();
  const toggleAi = useMutation({
    mutationFn: (aiEnabled: boolean) => api.patch<Organization>(`/organizations/${organization.id}`, { aiEnabled }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: meQueryKey });
      queryClient.invalidateQueries({ queryKey: ['ai-status', organization.id] });
      toast.success(o.aiEnabled ? 'AI assistant enabled' : 'AI assistant disabled');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Organization">
      <dl className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{organization.name}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Slug</dt>
          <dd>
            <code>{organization.slug}</code>
          </dd>
        </div>
      </dl>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div>
          <label htmlFor="ai-toggle" className="text-sm font-medium">
            Allow the AI assistant
          </label>
          <p className="text-xs text-muted-foreground">
            When enabled, text members submit to the assistant is sent to the configured external AI provider (after redaction of emails and secrets). Off by default.
          </p>
        </div>
        <Switch id="ai-toggle" checked={organization.aiEnabled} disabled={toggleAi.isPending} onCheckedChange={(v) => toggleAi.mutate(v)} />
      </div>
    </Panel>
  );
}

function MembersPanel({ manage }: { manage: boolean }) {
  const { organization, me } = useWorkspace();
  const { data: members, isPending } = useOrgMembers(organization.id);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<OrgRole, 'OWNER'>>('MEMBER');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.members(organization.id) });
  const add = useMutation({
    mutationFn: () => api.post(`/organizations/${organization.id}/members`, { email, role }),
    onSuccess: () => {
      invalidate();
      setEmail('');
      toast.success('Member added');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role: r }: { id: string; role: string }) => api.patch(`/organizations/${organization.id}/members/${id}`, { role: r }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organization.id}/members/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Members">
      {isPending ? (
        <LoadingRows rows={2} />
      ) : (
        <ul className="divide-y">
          {members?.map((m) => {
            const editable = manage && m.role !== 'OWNER' && m.userId !== me.user.id;
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{m.user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.user.email}</span>
                </span>
                {editable ? (
                  <span className="flex items-center gap-1">
                    <div className="w-32">
                      <NativeSelect aria-label={`Role of ${m.user.name}`} value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value })}>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {humanize(r)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <ConfirmDialog
                      title={`Remove ${m.user.name}?`}
                      description="They immediately lose access to every project in this organization."
                      confirmLabel="Remove"
                      onConfirm={() => remove.mutateAsync(m.id)}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`Remove ${m.user.name}`}>
                          <UserMinus />
                        </Button>
                      }
                    />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{humanize(m.role)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {manage && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) add.mutate();
          }}
        >
          <Input type="email" placeholder="colleague@company.com" aria-label="Member email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="sm:w-32">
            <NativeSelect aria-label="New member role" value={role} onChange={(e) => setRole(e.target.value as Exclude<OrgRole, 'OWNER'>)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" disabled={add.isPending}>
            Add
          </Button>
        </form>
      )}
      {manage && <p className="mt-2 text-xs text-muted-foreground">The person must already have an account. Email invitations are not available yet.</p>}
    </Panel>
  );
}

function AuditPanel() {
  const { organization } = useWorkspace();
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['audit', organization.id, page],
    queryFn: () => api.get<Paginated<AuditEntry>>(`/organizations/${organization.id}/audit-logs`, { page, pageSize: 15 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Panel title="Audit log" className="lg:col-span-2">
      {!data ? (
        <LoadingRows rows={3} />
      ) : (
        <>
          <ul className="divide-y text-sm">
            {data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{a.user?.name ?? 'System'}</span> <code className="text-xs text-muted-foreground">{a.action}</code>
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}
