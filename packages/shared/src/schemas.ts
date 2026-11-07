import { z } from 'zod';
import {
  BUG_SEVERITIES,
  BUG_STATUSES,
  ORG_ROLES,
  PRIORITIES,
  RESULT_STATUSES,
  TEST_CASE_STATUSES,
  TEST_PLAN_STATUSES,
  TEST_TYPES,
} from './enums.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().default('');
const id = z.string().uuid();

/**
 * Partial schema for PATCH bodies. Zod 4 still applies `.default()` inside `.partial()`,
 * which would silently reset omitted fields, so defaults are stripped first.
 */
function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      ((field instanceof z.ZodDefault ? field.unwrap() : field) as z.ZodType).optional(),
    ]),
    // Object.fromEntries loses key types; the mapped type restores them.
  ) as unknown as { [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]> };
  return z.object(shape);
}

export const passwordSchema = z
  .string()
  .min(12, 'Password must have at least 12 characters')
  .max(128, 'Password must have at most 128 characters')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Password must include lowercase, uppercase and a number',
  });

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: trimmed(100),
  email: emailSchema,
  password: passwordSchema,
  organizationName: trimmed(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const organizationCreateSchema = z.object({ name: trimmed(100) });

export const memberAddSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).exclude(['OWNER']),
});

export const memberUpdateSchema = z.object({
  role: z.enum(ORG_ROLES).exclude(['OWNER']),
});

export const organizationSettingsSchema = z.object({
  name: trimmed(100).optional(),
  aiEnabled: z.boolean().optional(),
});

export const projectCreateSchema = z.object({
  name: trimmed(120),
  description: optionalText(2000),
  leadId: id.nullable().optional(),
});
export const projectUpdateSchema = patchSchema(projectCreateSchema);

export const projectMemberAddSchema = z.object({ userId: id });

export const suiteCreateSchema = z.object({
  name: trimmed(120),
  description: optionalText(2000),
});
export const suiteUpdateSchema = patchSchema(suiteCreateSchema);

export const testStepSchema = z.object({
  action: trimmed(2000),
  expectedResult: optionalText(2000),
});

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-_.]*$/, 'Tags may contain letters, numbers, "-", "_" and "."');

export const testCaseCreateSchema = z.object({
  suiteId: id,
  title: trimmed(250),
  description: optionalText(5000),
  preconditions: optionalText(5000),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  type: z.enum(TEST_TYPES).default('FUNCTIONAL'),
  status: z.enum(TEST_CASE_STATUSES).default('DRAFT'),
  environment: optionalText(120),
  expectedResult: optionalText(5000),
  tags: z.array(tagSchema).max(20).default([]),
  assigneeId: id.nullable().optional(),
  automationKey: z.string().trim().max(500).nullable().optional(),
  steps: z.array(testStepSchema).max(100).default([]),
  aiGenerated: z.boolean().default(false),
});
export type TestCaseCreateInput = z.infer<typeof testCaseCreateSchema>;
export const testCaseUpdateSchema = patchSchema(testCaseCreateSchema.omit({ aiGenerated: true }));

export const SORTABLE_TEST_CASE_FIELDS = ['title', 'priority', 'createdAt', 'updatedAt'] as const;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const testCaseListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  suiteId: id.optional(),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(TEST_TYPES).optional(),
  status: z.enum(TEST_CASE_STATUSES).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  sort: z.enum(SORTABLE_TEST_CASE_FIELDS).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const testPlanCreateSchema = z.object({
  name: trimmed(150),
  description: optionalText(5000),
  scope: optionalText(5000),
  environment: optionalText(120),
  status: z.enum(TEST_PLAN_STATUSES).default('DRAFT'),
  suiteIds: z.array(id).max(200).default([]),
  testCaseIds: z.array(id).max(5000).default([]),
});
export const testPlanUpdateSchema = patchSchema(testPlanCreateSchema);

export const testRunCreateSchema = z.object({
  testPlanId: id,
  name: trimmed(150),
  environment: optionalText(120),
});

export const testResultUpdateSchema = z.object({
  status: z.enum(RESULT_STATUSES),
  actualResult: optionalText(5000),
  notes: optionalText(5000),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
});

export const bugCreateSchema = z.object({
  title: trimmed(250),
  description: optionalText(10_000),
  stepsToReproduce: optionalText(10_000),
  expectedResult: optionalText(5000),
  actualResult: optionalText(5000),
  severity: z.enum(BUG_SEVERITIES).default('MEDIUM'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  environment: optionalText(120),
  browser: optionalText(120),
  version: optionalText(60),
  assigneeId: id.nullable().optional(),
  testCaseId: id.nullable().optional(),
  testResultId: id.nullable().optional(),
});
export type BugCreateInput = z.infer<typeof bugCreateSchema>;
export const bugUpdateSchema = patchSchema(bugCreateSchema).extend({ status: z.enum(BUG_STATUSES).optional() });

export const bugListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(BUG_STATUSES).optional(),
  severity: z.enum(BUG_SEVERITIES).optional(),
  assigneeId: id.optional(),
});

export const aiGenerateTestCasesSchema = z.object({
  requirement: trimmed(8000),
  context: optionalText(4000),
});
export const aiPlaywrightSchema = z.object({
  scenario: trimmed(8000),
  baseUrl: z.string().trim().url().max(500).optional(),
  usePageObjects: z.boolean().default(true),
});
export const aiAnalyzeBugSchema = z.object({
  description: trimmed(8000),
});

/** Structured AI output contracts — the API validates provider responses against these. */
export const aiTestCaseSuggestionSchema = z.object({
  title: z.string().min(1).max(250),
  category: z.enum(['POSITIVE', 'NEGATIVE', 'EDGE_CASE', 'REGRESSION']),
  priority: z.enum(PRIORITIES),
  type: z.enum(TEST_TYPES),
  preconditions: z.string().max(5000).default(''),
  steps: z
    .array(z.object({ action: z.string().min(1).max(2000), expectedResult: z.string().max(2000).default('') }))
    .max(50),
  expectedResult: z.string().max(5000).default(''),
});
export const aiTestCasesResponseSchema = z.object({
  testCases: z.array(aiTestCaseSuggestionSchema).min(1).max(30),
});
export const aiPlaywrightResponseSchema = z.object({
  files: z
    .array(z.object({ path: z.string().min(1).max(200), content: z.string().min(1).max(50_000) }))
    .min(1)
    .max(10),
  notes: z.string().max(4000).default(''),
});
export const aiBugAnalysisResponseSchema = z.object({
  possibleCauses: z.array(z.string().max(1000)).max(10),
  missingInformation: z.array(z.string().max(1000)).max(10),
  reproductionSuggestions: z.array(z.string().max(1000)).max(10),
  suggestedSeverity: z.enum(BUG_SEVERITIES),
  suggestedPriority: z.enum(PRIORITIES),
  rationale: z.string().max(4000),
});
