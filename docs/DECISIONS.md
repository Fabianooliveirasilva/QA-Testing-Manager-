# Technical decisions

Short ADR-style records. Newest last.

### D1 — pnpm monorepo with a shared contracts package
Zod schemas in `packages/shared` are used by both the API (boundary validation) and the web forms.
One definition per contract prevents drift. `packages/config` from the initial brief was not created:
the root `tsconfig.base.json` and `eslint.config.js` cover it without an extra package.

### D2 — Dependency versions
Chosen for stability and verified compatibility on 2026-11-07 rather than "latest major":
TypeScript **5.9** (TS 7 native compiler is weeks old and typescript-eslint support is unconfirmed),
Prisma **6.19** (7/8 change the client generator and require driver adapters), Vite **7**,
React Router **7**, ESLint **9** (flat config), Vitest **4.1.12** (upgraded from 3.2 to fix
advisories GHSA in tinypool/@vitest/mocker). Upgrading these majors is listed as follow-up work.

### D3 — Opaque server-side sessions instead of JWT
A random 256-bit token in an `HttpOnly; SameSite=Lax` cookie, stored as SHA-256 in `sessions`.
Gives effective logout, "log out everywhere", revocation on password change/reset, sliding expiry
(12 h) capped by an absolute lifetime (7 days), with no token-refresh complexity in the SPA. CSRF is
handled by a per-session token sent in `x-csrf-token` (double submit bound to the server session).

### D4 — Argon2id for passwords
`argon2` with OWASP-recommended minimum parameters (m=19 MiB, t=2, p=1); hashes are upgraded on
login if parameters change (`needsRehash`). Unknown e-mails are verified against a dummy hash to keep
timing uniform.

### D5 — Tenancy through project-scoped routes
All project data is addressed as `/api/projects/:projectId/...`; the middleware checks organization
membership and every child query filters by `projectId`. Non-members get 404 (not 403) so ids cannot
be probed. Simpler and safer than row-level security for this MVP; RLS can be layered later.

### D6 — Playwright: import, not execute
The product imports the official JSON reporter output. Executing customer tests would require
sandboxed runners and is out of MVP scope; the parser and `AutomationExecution.executionSource` are
designed so a future runner can feed the same pipeline. Results link to test cases through an
explicit `qtm` annotation or the full title path (`file > describe > test`).

### D7 — Deduplication key for reports
`sha256(stats.startTime + suites)` with a unique index per project. Same report → 409 with the
existing run id; a re-run produces a new start time and is accepted.

### D8 — AI provider abstraction
`AiProvider.complete({ system, prompt, schema })` returns data validated against a Zod schema.
The Anthropic adapter uses the official SDK with structured outputs (`messages.parse` +
`zodOutputFormat`) and re-validates locally. Default model `claude-opus-5-5` (configurable via
`AI_MODEL`). Server-side refusal fallbacks were not enabled: a refusal is surfaced as a 422 to the
user instead of silently re-routing to another model. Other vendors plug in by implementing the
interface (no OpenAI adapter shipped to avoid untested code).

### D9 — Embedded PostgreSQL for machines without Docker
`embedded-postgres` ships real PostgreSQL 17 binaries via npm. Used by `pnpm db:start` for local
development/testing only; Docker Compose and CI use the official `postgres:17` image.

### D10 — Soft delete only where history matters
Test cases are soft-deleted (runs and bugs reference them). Plans with runs cannot be deleted
(archive instead). Suites can only be deleted when they never held cases. Bugs are hard-deleted
by admins together with their evidence.

### D11 — PATCH schemas strip defaults
Zod 4 applies `.default()` inside `.partial()`, which made partial updates reset omitted fields
(found by the integration suite). `patchSchema()` in `packages/shared` unwraps defaults; covered by
a regression test.

### D12 — Two database roles in Docker
The schema owner runs migrations at container start; the API connects as `qtm_app` with only
SELECT/INSERT/UPDATE/DELETE (default privileges), limiting the blast radius of an injection or RCE.
