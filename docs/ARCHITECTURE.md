# Architecture

## Overview

```
Browser (React SPA) ──/api──▶ nginx (prod) / Vite proxy (dev) ──▶ Express API ──▶ PostgreSQL
                                                                    │
                                                                    ├─ StorageProvider (local disk; S3-ready interface)
                                                                    ├─ Mailer (log mailer; SMTP-ready interface)
                                                                    └─ AiProvider (Anthropic adapter; provider-agnostic)
CI (external project) ──Bearer qtm_ token──▶ POST /api/automation/playwright
```

The SPA and the API are served from the **same origin** in every environment (Vite proxy in
development, nginx in Docker). This lets the session cookie be `SameSite=Lax` + `HttpOnly` and keeps
CORS strict.

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/shared` | Zod input schemas, enums and limits. Imported by the API (boundary validation) and the web (form validation), so both sides enforce the same contract. Built to `dist/` (`pnpm build:shared`). |
| `apps/api` | Express 5 app built by `createApp(ctx)`; dependencies (Prisma, storage, mailer, AI, config) are injected through `AppContext`, which is how tests replace the mailer and AI provider. |
| `apps/web` | Feature-oriented SPA (`src/features/<domain>`), shadcn/ui primitives in `src/components/ui`, shared app components in `src/components`, data access through TanStack Query + a small `api` client. |

## API structure (`apps/api/src`)

```
config/env.ts            Zod-validated environment (fails fast; refuses insecure cookies in production)
middleware/
  auth.ts                session cookie → req.user (sliding + absolute expiry), CSRF double-submit check
  access.ts              loadOrganization / loadProject (membership check, 404 for non-members), requirePermission, requireActiveProject
  error-handler.ts       maps AppError, Prisma, Multer and body-parser errors to a uniform JSON envelope; never leaks internals
modules/<domain>/        routes (+ services where logic is non-trivial)
  auth, organizations (+dashboard), projects, test-cases, test-plans, test-runs, bugs, attachments, automation, ai
services/                audit log, storage, mailer
utils/                   errors, crypto, permissions matrix, guards (cross-tenant reference checks), request-context accessors
```

### Request pipeline

`helmet → pino-http → cors → rate limit → /api/health → /api/automation (token, raw body) → json(1 MB) → cookies → loadSession → csrfProtection → /api/auth → requireAuth → /api/organizations | /api/projects/:projectId/* → 404 → errorHandler`

### Tenancy and authorization model

- Every project-scoped route lives under `/api/projects/:projectId/...`. `loadProject` resolves the
  project, then the caller's membership in the **project's organization**; non-members receive 404.
- Every query for a child resource filters by **both** its id and `projectId` (e.g.
  `findFirst({ where: { id, projectId } })`), so ids from other projects/organizations never match.
- References inside payloads (suite, assignee, linked test case/result, attachment target) are
  validated to belong to the same project/organization (`utils/guards.ts`, per-route `assert*`).
- Role permissions (`utils/permissions.ts`): Viewer = read; Member = read + write test artifacts;
  Admin/Owner = + manage projects, members, tokens, delete bugs, audit log. The Owner membership
  cannot be modified or removed.

## Data model (Prisma)

Core: `User`, `Session`, `PasswordResetToken`, `Organization`, `OrganizationMember(role)`,
`Project`, `ProjectMember`, `TestSuite`, `TestCase` (+`TestStep`), `TestPlan` (+`TestPlanCase`),
`TestRun` (`source` MANUAL | PLAYWRIGHT), `TestResult`, `Bug` (+`BugHistory`), `Attachment`
(polymorphic: TEST_CASE | TEST_RESULT | BUG), `AutomationExecution`, `ApiToken`, `AuditLog`,
`AiRequest`.

Notable choices:

- **Test case status vs execution status** are different enums (`TestCaseStatus` DRAFT/READY/DEPRECATED
  vs `ResultStatus` NOT_RUN/PASSED/FAILED/BLOCKED/SKIPPED).
- **Results snapshot the title** at run start, so history stays readable if the case changes.
- **Soft delete** for test cases (`deletedAt`) keeps execution history and bug links; deleted cases
  leave active plans.
- **Automated results** may have no test case (`testCaseId` null) and store `automationKey`,
  retries, error/stack and metadata.
- `AutomationExecution(projectId, reportHash)` is unique → duplicate imports are rejected even under races.
- Indexes on the access paths used by lists and dashboards (`projectId`+status/severity, run dates, etc.).

## Frontend structure (`apps/web/src`)

- `router.tsx` — route tree; feature pages are lazy-loaded (code splitting).
- `features/auth/session.tsx` — `RequireAuth`/`GuestOnly` guards and the workspace context
  (current organization and project, persisted per user in `localStorage`).
- `features/projects/project-scope.tsx` — layout for `/p/:projectId/*` that loads the project once
  and exposes `writable` (role + not archived) to child pages. UI permission checks are hints only;
  the API enforces everything.
- Forms use the shared Zod schemas through `@hookform/resolvers/zod`.

## Testing architecture

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | Playwright report parser, file validation, redaction, permissions, config, shared schemas, web utils/components |
| Integration / API / security | Vitest + Supertest | Real Express app + real PostgreSQL (`TEST_DATABASE_URL`, migrations applied in global setup, tables truncated per file) |
| E2E + accessibility | Playwright + axe-core | Real browser → Vite → API → PostgreSQL |

The only test double is the AI provider in `tests/ai.test.ts` (the external vendor), documented as such.
