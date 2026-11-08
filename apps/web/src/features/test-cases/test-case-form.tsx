import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PRIORITIES, TEST_CASE_STATUSES, TEST_TYPES, testCaseCreateSchema } from '@qtm/shared';
import { Field } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/features/auth/session';
import { useOrgMembers, useSuites } from '@/features/projects/queries';
import { humanize } from '@/lib/format';

const emptyToNull = (v: unknown) => (v === '' ? null : v);

export type TestCaseFormValues = z.input<typeof testCaseCreateSchema>;
export type TestCaseFormOutput = z.output<typeof testCaseCreateSchema>;

export function TestCaseForm({
  projectId,
  defaultValues,
  submitLabel,
  pending,
  onSubmit,
}: {
  projectId: string;
  defaultValues: TestCaseFormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: TestCaseFormOutput) => void;
}) {
  const { organization } = useWorkspace();
  const suites = useSuites(projectId);
  const members = useOrgMembers(organization.id);
  const [tagsText, setTagsText] = useState((defaultValues.tags ?? []).join(', '));
  const form = useForm<TestCaseFormValues, unknown, TestCaseFormOutput>({ resolver: zodResolver(testCaseCreateSchema), defaultValues });
  const steps = useFieldArray({ control: form.control, name: 'steps' });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) =>
    onSubmit({ ...values, assigneeId: values.assigneeId || null, automationKey: values.automationKey?.trim() || null }),
  );

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        form.setValue(
          'tags',
          tagsText
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
        );
        void submit(e);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Title" htmlFor="tc-title" error={errors.title?.message}>
            <Input id="tc-title" aria-invalid={!!errors.title} {...form.register('title')} />
          </Field>
        </div>
        <Field label="Suite" htmlFor="tc-suite" error={errors.suiteId?.message}>
          <NativeSelect id="tc-suite" {...form.register('suiteId')}>
            {suites.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Assignee" htmlFor="tc-assignee" error={errors.assigneeId?.message}>
          <NativeSelect id="tc-assignee" {...form.register('assigneeId', { setValueAs: emptyToNull })}>
            <option value="">Unassigned</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Priority" htmlFor="tc-priority">
          <NativeSelect id="tc-priority" {...form.register('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {humanize(p)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Type" htmlFor="tc-type">
          <NativeSelect id="tc-type" {...form.register('type')}>
            {TEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'API' || t === 'E2E' ? t : humanize(t)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Status" htmlFor="tc-status">
          <NativeSelect id="tc-status" {...form.register('status')}>
            {TEST_CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Environment" htmlFor="tc-env" error={errors.environment?.message}>
          <Input id="tc-env" placeholder="e.g. staging, Chrome 130" {...form.register('environment')} />
        </Field>
        <Field label="Tags" htmlFor="tc-tags" hint="Comma separated, e.g. smoke, checkout" error={errors.tags?.message ?? errors.tags?.[0]?.message}>
          <Input id="tc-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </Field>
        <Field
          label="Automation key"
          htmlFor="tc-automation"
          hint="Links Playwright results: use test annotation { type: 'qtm', description: KEY } or the full title path."
          error={errors.automationKey?.message}
        >
          <Input id="tc-automation" placeholder="e.g. LOGIN-001" {...form.register('automationKey')} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Description" htmlFor="tc-description">
            <Textarea id="tc-description" rows={3} {...form.register('description')} />
          </Field>
        </div>
        <Field label="Preconditions" htmlFor="tc-pre">
          <Textarea id="tc-pre" rows={3} {...form.register('preconditions')} />
        </Field>
        <Field label="Expected result" htmlFor="tc-expected">
          <Textarea id="tc-expected" rows={3} {...form.register('expectedResult')} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Steps</legend>
        {steps.fields.length === 0 && <p className="text-sm text-muted-foreground">No steps yet.</p>}
        {steps.fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[2rem_1fr_1fr_auto]">
            <span className="pt-2 text-sm font-semibold text-muted-foreground tabular-nums">{index + 1}.</span>
            <div>
              <label className="sr-only" htmlFor={`step-action-${index}`}>
                Step {index + 1} action
              </label>
              <Textarea id={`step-action-${index}`} rows={2} placeholder="Action" {...form.register(`steps.${index}.action`)} aria-invalid={!!errors.steps?.[index]?.action} />
              {errors.steps?.[index]?.action && <p className="mt-1 text-xs text-destructive">{errors.steps[index]?.action?.message}</p>}
            </div>
            <div>
              <label className="sr-only" htmlFor={`step-expected-${index}`}>
                Step {index + 1} expected result
              </label>
              <Textarea id={`step-expected-${index}`} rows={2} placeholder="Expected result" {...form.register(`steps.${index}.expectedResult`)} />
            </div>
            <div className="flex gap-1 md:flex-col">
              <Button type="button" variant="ghost" size="icon" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => steps.move(index, index - 1)}>
                <ArrowUp />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move step ${index + 1} down`} disabled={index === steps.fields.length - 1} onClick={() => steps.move(index, index + 1)}>
                <ArrowDown />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove step ${index + 1}`} onClick={() => steps.remove(index)}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => steps.append({ action: '', expectedResult: '' })}>
          <Plus /> Add step
        </Button>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
