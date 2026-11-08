# Project status

_Last verified: 2026-11-07, on Linux, Node 22.19, PostgreSQL 17 (embedded-postgres), Chromium (Playwright 1.65)._

## Verified results

| Check | Result |
| --- | --- |
| `pnpm lint` (ESLint strict TS) | ✅ 0 errors |
| `pnpm typecheck` (tsc, all packages) | ✅ 0 errors |
| Shared unit tests (Vitest) | ✅ 10 / 10 |
| API unit tests | ✅ 44 / 44 |
| API integration + API + security tests (real PostgreSQL) | ✅ 97 / 97 (7 files) |
| Web unit/component tests | ✅ 11 / 11 |
| E2E (Playwright, real stack, incl. axe-core a11y) | ✅ 8 / 8; stability check `--repeat-each=3`: 24 / 24 |
| `pnpm audit` | ✅ no known vulnerabilities |
| `pnpm build` (API tsc + web Vite) | ✅ |
| Docker images | ✅ API and web images build in GitHub Actions (job `docker`) |
| Docker Compose stack (`up`, migrations, health checks, DB roles) | ⛔ **Not executed** — Docker is not installed on the development machine and CI only builds images |
| GitHub Actions CI | ✅ All jobs green (quality, E2E, docker) — [run 42432289780](https://github.com/Fabianooliveirasilva/QA-Testing-Manager-/actions/runs/42432289780) |
| Live AI provider call | ⛔ **Not executed** — no API key available. Logic tested with a provider test double. |
| Coverage % | Not measured (no coverage tool configured; numbers above are test counts). |

Total automated tests executed in the final run: **170 passed, 0 failed, 0 skipped**
(10 + 44 + 97 + 11 + 8).

### Defects found by the tests and fixed (root cause, not by changing expectations)

1. Zod 4 applied `.default()` inside `.partial()` → PATCH reset omitted fields (e.g. bug severity). Fixed with `patchSchema()`, regression test added.
2. Empty "Unassigned/No lead" selects submitted `''`, failing UUID validation with no visible message → forms silently did not submit. Mapped to `null` and errors surfaced.
3. Login redirect race: guest guard redirected to `/` before honoring the original destination. Guard now redirects to `state.from`.
4. Global search wrapper carried popover ARIA attributes on a `div` (axe `aria-allowed-attr`). Now uses `PopoverAnchor`.
5. Stale UI data: suite case counts and dashboard metrics served from cache after changes. Now invalidated/refetched.
6. Fresh clones had no generated Prisma client (only `typecheck` generated it), so the API could not start — found by the first CI E2E run. `@qtm/api` now runs `prisma generate` on `postinstall`.

Test-side corrections (each proven by the failure output before changing): substring collisions in
locators (`valid credentials` ⊂ `invalid credentials`, `Flaky` ⊂ title, toast text, empty-state
heading) and a locator scoped to the wrong element. No assertion was removed or weakened.

## Feature completeness

**Complete:** auth (register, login, logout, logout-all, lockout, reset, change password), organizations
& members & roles, project CRUD/archive/team/lead, suites, test cases (all fields, steps, tags,
search/filter/sort/pagination, duplicate, soft delete), test plans, manual runs, bug tracking with
history, evidence uploads, Playwright JSON import (UI + CI token, dedup, linking), dashboard from real
data, global search, activity, audit log, AI assistant (opt-in, quota, redaction, validation), seed,
docs, CI workflow.

**Partial:**
- Password reset e-mail delivery: link generated and logged in development; no production mail provider.
- Member onboarding: only existing accounts can be added (no e-mail invitations).
- AI: Anthropic adapter only; live call not verified (configuration dependency).
- Evidence for automated results: Playwright attachment names/paths are recorded, binaries are not uploaded.

**Not implemented (out of MVP scope):** remote test execution, MFA/SSO, notifications by e-mail,
S3 storage driver, malware scanning, Redis-backed rate limiting for multi-instance deployments.

## How to resume work

Read `CLAUDE.md` (conventions) → `docs/ARCHITECTURE.md` → `docs/DECISIONS.md`. Start PostgreSQL with
`pnpm db:start`, then follow the README.
