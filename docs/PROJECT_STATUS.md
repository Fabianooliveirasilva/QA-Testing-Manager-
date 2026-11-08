# Project status

_Last verified: 2026-11-08 (round 2), Linux, Node 22.19, PostgreSQL 17 (embedded-postgres locally,
`postgres:17.6-alpine` in CI), Chromium via Playwright 1.65._

## Verified results

| Check | Result (local) |
| --- | --- |
| `pnpm lint` | ✅ 0 errors |
| `pnpm typecheck` | ✅ 0 errors |
| Shared unit tests | ✅ 10 / 10 |
| API unit tests | ✅ 59 / 59 |
| API integration tests (real PostgreSQL) | ✅ 56 / 56 |
| API security tests (real PostgreSQL) | ✅ 64 / 64 |
| Web unit/component tests | ✅ 11 / 11 |
| E2E (Playwright + axe-core) | ✅ 8 / 8; stability `--repeat-each=3`: 24 / 24 |
| Coverage thresholds (`pnpm test:coverage`) | ✅ met — see [TESTING.md](TESTING.md) |
| `pnpm build` | ✅ |
| `pnpm audit` | ✅ no known vulnerabilities |
| Docker images build | ✅ in CI |
| Docker Compose smoke test | Runs in CI (`docker` job); Docker is not installed on the development machine, so it was never run locally |
| Live AI provider call | ⛔ not executed — no API key; adapter verified with the official SDK against a local API stub |

CI results for each commit: [GitHub Actions](https://github.com/Fabianooliveirasilva/QA-Testing-Manager-/actions/workflows/ci.yml).

### Test counts

| | Round 1 | Round 2 |
| --- | --- | --- |
| Shared unit | 10 | 10 |
| API unit | 44 | 59 |
| API integration + security | 97 | 120 (56 + 64) |
| Web unit | 11 | 11 |
| E2E | 8 | 8 |
| **Total** | **170** | **208** (208 passed, 0 failed, 0 skipped) |

### Defects found by tests and fixed (root cause; each has a regression test that fails on the old code)

Round 1:
1. Zod 4 applied `.default()` inside `.partial()` → PATCH reset omitted fields.
2. Empty "Unassigned/No lead" selects blocked form submission silently.
3. Login redirect race ignored the original destination.
4. `aria-allowed-attr` violation on the global search.
5. Stale cached dashboard metrics and suite counts.
6. Fresh clones had no generated Prisma client (API failed at startup in CI).

Round 2 (audit — see the severity table in [SECURITY.md](SECURITY.md#round-2-audit-2026-11-08)):
7. HIGH — password-reset token redeemable twice by concurrent requests.
8. HIGH — AI daily quota bypassable by concurrency (8/8 accepted with a limit of 3).
9. MEDIUM — results written after a run was completed (14/15 attempts) and runs closable several times.
10. MEDIUM — removed members remained project lead/assignee; their CI tokens stayed active until use.
11. MEDIUM — AI refusal/truncation reported as a generic 503 (parse error before `stop_reason` check).
12. MEDIUM — nginx served `/assets/*` without security headers; duplicated `X-Frame-Options` on API.
13. MEDIUM — run `finishedAt` could predate a result committed just before it (timestamp taken before the lock) — found by CI.
14. LOW — locked accounts answered ~10× faster than failed logins (timing oracle).
15. LOW — production could boot with localhost `APP_URL`/`WEB_ORIGIN` defaults.
16. LOW — AI worst-case latency exceeded the proxy timeout.

Test-side corrections (proven by the failure output): ambiguous Playwright locators (substring
collisions with titles, toasts, empty states), an HTTP client that refuses CR/LF headers, an outdated
assumption about the SDK's auth header. No assertion was removed or weakened.

## Feature completeness

**Complete:** authentication (register, login, logout, logout-all, lockout, reset, change password,
registration switch, admin bootstrap CLI), organizations/members/roles, projects (CRUD, archive, team,
lead, tokens), suites, test cases, plans, manual runs, bugs with history, evidence uploads (with scan
hook), Playwright import (UI + CI token), dashboard, search, audit log, AI assistant (opt-in, quotas,
redaction, validation), request correlation and health checks, seed, Docker, CI/CD, documentation.

**Partial / external dependencies:**
- E-mail delivery (password reset, invitations) — no mail provider integrated.
- AI — Anthropic adapter not verified with a live API key.
- Malware scanning — hook only; no engine bundled (files stored as `NOT_SCANNED`).
- Automated-run attachments — names/paths recorded, binaries not uploaded.

**Not implemented:** remote test execution, MFA/SSO, invitations, S3 storage, shared rate-limit store,
admin-initiated password reset.

## Production readiness

Ready for a **controlled pilot** (single instance, HTTPS, backups, trusted users). Not ready for open
public production until e-mail delivery exists (no password recovery path) — see
[DEPLOYMENT.md](DEPLOYMENT.md#readiness-verdict).
