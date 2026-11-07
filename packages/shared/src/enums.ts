export const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TEST_TYPES = [
  'FUNCTIONAL',
  'REGRESSION',
  'SMOKE',
  'INTEGRATION',
  'API',
  'E2E',
  'EXPLORATORY',
  'SECURITY',
] as const;
export type TestType = (typeof TEST_TYPES)[number];

/** Lifecycle of the test case definition — never an execution outcome. */
export const TEST_CASE_STATUSES = ['DRAFT', 'READY', 'DEPRECATED'] as const;
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];

export const TEST_PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;
export type TestPlanStatus = (typeof TEST_PLAN_STATUSES)[number];

export const TEST_RUN_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABORTED'] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export const RUN_SOURCES = ['MANUAL', 'PLAYWRIGHT'] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

export const RESULT_STATUSES = ['NOT_RUN', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const BUG_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const ATTACHMENT_ENTITY_TYPES = ['TEST_CASE', 'TEST_RESULT', 'BUG'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const AUTOMATION_STATUSES = ['PASSED', 'FAILED', 'INTERRUPTED'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

/** Allowed evidence uploads. Validated server-side by extension, declared MIME and magic bytes. */
export const ALLOWED_UPLOADS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
} as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PLAYWRIGHT_REPORT_BYTES = 20 * 1024 * 1024;
