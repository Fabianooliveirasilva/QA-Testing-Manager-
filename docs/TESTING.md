# Testing strategy & coverage

## Principles

1. **Real infrastructure for everything we own.** Integration, security and E2E tests use a real
   PostgreSQL database and the real Express app; E2E drives a real browser through the Vite proxy.
2. **Test doubles only for external vendors** — the AI provider API (a local HTTP stub, exercised through
   the official Anthropic SDK) and the malware engine (an EICAR-detecting double). Each is labelled in code.
3. **Bugs become regression tests first.** Every defect fixed in this project has a test that fails on the
   old code (verified by temporarily reverting the fix) — see the defect log in
   [PROJECT_STATUS.md](PROJECT_STATUS.md).
4. **No weakened assertions.** Test corrections are only made when the failure output proves the test was
   wrong (e.g. ambiguous locators), and are recorded.

## Suites

| Command | Scope |
| --- | --- |
| `pnpm --filter @qtm/shared test` | Contract schemas (incl. PATCH-default regression) |
| `pnpm --filter @qtm/api test:unit` | Parsers, validators, redaction, permissions, config, mailer, AI adapter |
| `pnpm --filter @qtm/api test:integration` | Workflows, dashboards, imports, AI service, concurrency, health/ops |
| `pnpm --filter @qtm/api test:security` | Access control/IDOR, auth/session/CSRF/reset, uploads, injection/XSS, error hygiene |
| `pnpm --filter @qtm/web test` | Web utilities and components |
| `pnpm test:e2e` | Playwright + axe-core against the full stack |
| `./scripts/compose-smoke.sh` | Production Docker stack end to end (CI `docker` job) |

### Concurrency tests

Race conditions are tested by firing simultaneous requests at the real database:
reset-token redemption, result writes vs. run completion, duplicate run closure, AI quota reservation,
duplicate report imports. These found four real defects (see PROJECT_STATUS).

## Coverage

Measured with `@vitest/coverage-v8` (`pnpm test:coverage`). Thresholds are a **ratchet** set just
below the measured baseline, so coverage cannot silently regress; they were not chosen to hit a target.

| Package | Lines | Statements | Functions | Branches | Threshold (L/S/F/B) |
| --- | --- | --- | --- | --- | --- |
| `packages/shared` | 100% | 100% | 100% | 100% | 95 / 95 / 95 / 95 |
| `apps/api` | 94.5% | 92.0% | 93.2% | 77.2% | 92 / 90 / 90 / 75 |
| `apps/web` (unit only) | 7.7% | 8.0% | 4.3% | 5.1% | 7 / 7 / 4 / 5 |

How to read this:

- **API** coverage combines unit + integration + security tests. Before this round it was 86.8% lines /
  67.6% branches; the increase came from tests for modules with real risk (AI adapter error mapping,
  plan/project/suite/token rules, member removal, mailer secrecy), not from padding.
- Remaining API branch gaps are mostly defensive branches (e.g. `?? fallback` values, Prisma error
  translation for constraint types we never trigger) — listed by `coverage/index.html`.
- **Web** unit coverage is deliberately low: the UI is verified by Playwright E2E (8 specs covering the
  full lifecycle, access control and accessibility), which is not instrumented for coverage. Adding
  E2E coverage instrumentation (Istanbul via Vite) is on the roadmap.
- `src/components/ui/**` (vendored shadcn/ui) and `main.tsx` are excluded from web coverage.

CI publishes the coverage table on each run's summary page and uploads the HTML reports as an artifact.

## Flakiness policy

E2E stability is checked with `--repeat-each=3` before merging changes to specs. Locators must be exact
or scoped to a region/row: toasts and empty states otherwise collide with substring matches (this caused
the only flaky failures observed, all fixed in the tests).
