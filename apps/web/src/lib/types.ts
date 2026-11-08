import type {
  AutomationStatus,
  BugSeverity,
  BugStatus,
  OrgRole,
  Priority,
  ProjectStatus,
  ResultStatus,
  RunSource,
  TestCaseStatus,
  TestPlanStatus,
  TestRunStatus,
  TestType,
} from '@qtm/shared';

/** Response shapes returned by the API (see docs/API.md). */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  aiEnabled: boolean;
  role: OrgRole;
}

export interface Me {
  user: UserSummary & { createdAt: string };
  csrfToken: string;
  organizations: Organization[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Member {
  id: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
  user: UserSummary;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  leadId: string | null;
  lead: UserSummary | null;
  createdAt: string;
  updatedAt: string;
  role?: OrgRole;
  _count: { testCases: number; bugs: number; testRuns: number; testPlans?: number };
}

export interface Suite {
  id: string;
  name: string;
  description: string;
  _count: { testCases: number };
}

export interface TestStep {
  id: string;
  position: number;
  action: string;
  expectedResult: string;
}

export interface TestCaseListItem {
  id: string;
  title: string;
  priority: Priority;
  type: TestType;
  status: TestCaseStatus;
  tags: string[];
  aiGenerated: boolean;
  automationKey: string | null;
  updatedAt: string;
  suite: { id: string; name: string };
  assignee: UserSummary | null;
  _count: { steps: number };
}

export interface TestCase extends Omit<TestCaseListItem, '_count'> {
  description: string;
  preconditions: string;
  environment: string;
  expectedResult: string;
  suiteId: string;
  assigneeId: string | null;
  createdBy: UserSummary;
  createdAt: string;
  steps: TestStep[];
  recentResults?: {
    id: string;
    status: ResultStatus;
    executedAt: string | null;
    testRun: { id: string; name: string; source: RunSource };
    executedBy: UserSummary | null;
  }[];
}

export type StatusCounts = Record<ResultStatus, number> & { total: number };

export interface TestPlan {
  id: string;
  name: string;
  description: string;
  scope: string;
  environment: string;
  status: TestPlanStatus;
  createdAt: string;
  updatedAt: string;
  _count: { cases: number; runs?: number };
}

export interface TestRunSummary {
  id: string;
  name: string;
  environment: string;
  source: RunSource;
  status: TestRunStatus;
  startedAt: string;
  finishedAt: string | null;
  executedBy: UserSummary;
  testPlan?: { id: string; name: string } | null;
  summary: StatusCounts;
  passRate?: number | null;
}

export interface TestPlanDetail extends TestPlan {
  cases: {
    id: string;
    title: string;
    priority: Priority;
    type: TestType;
    status: TestCaseStatus;
    deletedAt: string | null;
    suite: { id: string; name: string };
  }[];
  runs: TestRunSummary[];
}

export interface TestResult {
  id: string;
  title: string;
  status: ResultStatus;
  actualResult: string;
  notes: string;
  durationMs: number | null;
  retries: number;
  errorMessage: string | null;
  errorStack: string | null;
  automationKey: string | null;
  metadata: {
    file?: string;
    projectName?: string;
    flaky?: boolean;
    tags?: string[];
    attachments?: { name: string; contentType: string; path?: string }[];
  } | null;
  executedAt: string | null;
  executedBy: UserSummary | null;
  testCase: {
    id: string;
    title: string;
    priority: Priority;
    preconditions: string;
    expectedResult: string;
    steps: TestStep[];
  } | null;
  _count: { bugs: number };
}

export interface AutomationExecution {
  id: string;
  testRunId: string;
  executionSource: string;
  status: AutomationStatus;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  matched: number;
  durationMs: number;
  startedAt: string | null;
  createdAt: string;
  reportMetadata: { playwrightVersion: string | null; globalErrors: string[] };
  testRun?: { id: string; name: string; environment: string };
}

export interface TestRunDetail extends Omit<TestRunSummary, 'summary'> {
  summary: StatusCounts;
  passRate: number | null;
  results: TestResult[];
  automation: AutomationExecution | null;
}

export interface Bug {
  id: string;
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  severity: BugSeverity;
  priority: Priority;
  status: BugStatus;
  environment: string;
  browser: string;
  version: string;
  assigneeId: string | null;
  testCaseId: string | null;
  testResultId: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: UserSummary | null;
  createdBy: UserSummary;
}

export interface BugDetail extends Bug {
  testCase: { id: string; title: string; deletedAt: string | null } | null;
  testResult: { id: string; title: string; status: ResultStatus; testRunId: string } | null;
  history: {
    id: string;
    field: string;
    fromValue: string | null;
    toValue: string | null;
    createdAt: string;
    user: UserSummary | null;
  }[];
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy?: UserSummary | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export interface DashboardData {
  totals: { projects: number; testCases: number; openBugs: number; criticalBugs: number };
  results: StatusCounts & { windowDays: number; passRate: number | null };
  executionHistory: { date: string; PASSED: number; FAILED: number; BLOCKED: number; SKIPPED: number }[];
  bugsBySeverity: { severity: BugSeverity; count: number }[];
  recentRuns: (Omit<TestRunSummary, 'executedBy' | 'environment' | 'finishedAt'> & { projectId: string; project: { name: string } })[];
  recentActivity: AuditEntry[];
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: UserSummary | null;
}

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  enabledForOrganization: boolean;
  dailyLimit: number;
  usedToday: number;
}
