# QA Testing Manager

A SaaS web application to manage the software quality lifecycle: projects, test suites and
cases, test plans, manual test runs, bug tracking with evidence, Playwright report import and an
AI test assistant — with multi-organization isolation and role-based access control.

> **Status:** MVP feature-complete and verified by automated tests. See
> [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for what is done, partial and pending, and the
> latest verified test results.

## Features

| Area | What you can do |
| --- | --- |
| Dashboard | Real metrics from the database: projects, test cases, passed/failed/blocked (30 days), pass rate, open and critical bugs, 14‑day execution history, bugs by severity, recent runs and activity. Filter by project. |
| Projects | Create, edit, archive/restore (archived = read-only), lead, project team, suites, per-project metrics, CI API tokens. |
| Test cases | Title, description, preconditions, ordered steps, expected result, priority, type (Functional, Regression, Smoke, Integration, API, E2E, Exploratory, Security), status, environment, tags, assignee, automation key. Search, filter, sort, paginate, duplicate, soft-delete, evidence. |
| Test plans | Scope, environment, status; include whole suites and/or individual cases; execution history. |
| Test runs | Manual execution of a plan: Pass / Fail / Block / Skip per case with actual result, notes, duration and evidence; complete or abort. Execution status never changes the test case definition status. |
| Bugs | Severity, priority, status (Open, In progress, Resolved, Closed, Reopened), environment, browser, version, steps, expected/actual, assignee, evidence, full field-level change history, links to test case and failed result. |
| Evidence | PNG, JPEG, WebP, PDF, TXT, LOG, JSON up to 10 MB, validated by extension, declared MIME **and file content**. |
| Automation | Import Playwright JSON reports from the UI or from CI with a project token; passed/failed/skipped/flaky, retries, durations, errors and stack traces; deduplication; links results to test cases via automation keys. The system **imports** results — it does not execute your tests. |
| AI assistant | Generate test cases from requirements, Playwright code suggestions, bug analysis. Provider-agnostic, opt-in per organization, redacts secrets, validates structured output, per-user daily limit. Output is always a draft for human review. |
| Organizations | Multiple organizations per user, members with roles Owner/Admin/Member/Viewer, audit log. |

## Stack

- **Web:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui (Radix), Lucide, React Router 7, TanStack Query 5, React Hook Form + Zod, Recharts.
- **API:** Node.js 22, Express 5, TypeScript, Zod, Prisma 6, PostgreSQL 17, Argon2id, Helmet, express-rate-limit, Multer, file-type, Pino.
- **Tests:** Vitest 4 (unit/integration/API with Supertest against real PostgreSQL), Playwright 1.65 (E2E + axe-core accessibility).
- **Infra:** pnpm workspaces, Docker / Docker Compose, nginx, GitHub Actions.

## Repository layout

```
apps/
  api/                 Express API (src/modules/* per domain, prisma/ schema+migrations+seed, tests/ integration)
  web/                 React SPA (src/features/* per domain, src/components/ui shadcn, e2e/ Playwright)
packages/shared/       Zod schemas, enums and limits shared by API and web (single source of truth)
examples/playwright-sample/  A real external Playwright project used to produce importable reports
infrastructure/        nginx and PostgreSQL init (least-privilege role)
docs/                  Architecture, decisions, API, security, AI, Playwright integration, status
.github/workflows/     CI pipeline + example workflow for external projects
```

## Prerequisites

- Node.js **22.12+** and pnpm **10** (`corepack enable && corepack prepare pnpm@10.20.0 --activate`)
- PostgreSQL 17 — via Docker **or** the bundled `pnpm db:start` (real PostgreSQL binaries from the `embedded-postgres` package, for machines without Docker)

## Local development

```bash
pnpm install
cp .env.example .env          # then edit secrets/ports if needed
pnpm db:start                 # terminal 1: PostgreSQL on :5432 (creates qtm_dev and qtm_test). Or use your own server.
pnpm db:deploy                # apply migrations to DATABASE_URL
pnpm db:seed                  # optional: "Demo Workspace" sample data (refuses to run in production)
pnpm dev:api                  # terminal 2: API on http://localhost:4000
pnpm dev:web                  # terminal 3: web on http://localhost:5173 (proxies /api)
```

If you use your own PostgreSQL, point `DATABASE_URL`/`TEST_DATABASE_URL` in `.env` to it (the test
database name must contain `test`; the integration suite truncates it).

**Demo accounts** (after `pnpm db:seed`): `owner@demo.qtm.local`, `member@demo.qtm.local`,
`viewer@demo.qtm.local` — password from `SEED_PASSWORD`, defaulting to `DemoPassw0rd!2026`
(development only; the seed refuses `NODE_ENV=production`).

Password reset emails: no SMTP provider is bundled. In development the reset link is written to the
API log; in production the message is not logged (see [docs/SECURITY.md](docs/SECURITY.md)).

## Tests

```bash
pnpm lint                                   # ESLint (strict TypeScript rules)
pnpm typecheck                              # tsc across all packages
pnpm test                                   # shared + API (unit + integration on real PostgreSQL) + web unit
pnpm --filter @qtm/api test:unit            # API unit tests only (no database)
pnpm --filter @qtm/api test:integration     # API integration/security tests (needs TEST_DATABASE_URL)
pnpm test:e2e                               # Playwright: starts API (:4100) + web (:5174) on TEST_DATABASE_URL
pnpm audit:deps                             # dependency audit, fails on high/critical
```

E2E needs Chromium once: `pnpm --filter @qtm/web exec playwright install chromium`.

## Docker

```bash
cp .env.docker.example .env.docker   # set real passwords
docker compose --env-file .env.docker up --build
# → http://localhost:8080
docker compose --env-file .env.docker down                    # add -v to also delete database and uploads
```

The compose stack runs PostgreSQL (health-checked, persistent volume), the API (migrations run at
start with the schema-owner role; the server connects with a DML-only role) and nginx serving the
SPA and proxying `/api`. `COOKIE_SECURE=true` requires HTTPS, except on `localhost` where browsers
accept secure cookies.

## Playwright integration

Generate a JSON report in any Playwright project and upload it from the **Automation** page, or from
CI with a project token:

```bash
npx playwright test --reporter=json > report.json
curl -fsS -X POST "$QTM_URL/api/automation/playwright?runName=CI%20%2342" \
  -H "Authorization: Bearer $QTM_TOKEN" -H "Content-Type: application/json" --data-binary @report.json
```

Details, mapping rules and the sample project: [docs/PLAYWRIGHT.md](docs/PLAYWRIGHT.md).

## AI configuration

Disabled by default. Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (optionally `AI_MODEL`),
then an organization admin enables the assistant in **Settings**. See [docs/AI.md](docs/AI.md).

## CI/CD

`.github/workflows/ci.yml` runs on pushes and PRs: frozen-lockfile install → lint → type check →
unit tests → integration/API tests on a PostgreSQL service → build → `pnpm audit` (high) → E2E with
Playwright (report uploaded as artifact) → Docker image builds. No step is allowed to fail silently.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Technical decisions](docs/DECISIONS.md) · [API reference](docs/API.md)
- [Security](docs/SECURITY.md) · [AI assistant](docs/AI.md) · [Playwright integration](docs/PLAYWRIGHT.md)
- [Project status & test results](docs/PROJECT_STATUS.md) · [Demo script](docs/DEMO.md)
