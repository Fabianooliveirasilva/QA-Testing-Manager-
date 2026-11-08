# CLAUDE.md — working conventions for QA Testing Manager

Read `docs/PROJECT_STATUS.md` first (what is verified, partial, blocked), then
`docs/ARCHITECTURE.md` and `docs/DECISIONS.md`. Do not duplicate their content here.

## Commands

- DB: `pnpm db:start` (embedded PostgreSQL 17 on :5432, DBs `qtm_dev` + `qtm_test`), `pnpm db:deploy`, `pnpm db:seed`
- New migration: `pnpm db:migrate --name <change>` (never delete committed migrations; `migrate reset` is blocked for AI agents by Prisma — ask the user)
- Dev: `pnpm dev:api` (:4000), `pnpm dev:web` (:5173, proxies `/api`)
- Quality gate before declaring work done: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm test:e2e && pnpm build && pnpm audit:deps` (+ `./scripts/compose-smoke.sh` where Docker exists; CI runs it)
- API test projects: `test:unit`, `test:integration`, `test:security` (security = auth, access-control, attachments, security files)
- Admin bootstrap: `pnpm --filter @qtm/api admin:create -- --email … --name … --org …`; README screenshots: `pnpm --filter @qtm/web screenshots` (dev servers + seed running)
- `packages/shared` must be built (`pnpm build:shared`) before API/web typecheck or tests.

## Conventions

- Contracts: add/modify input schemas in `packages/shared/src/schemas.ts`; PATCH schemas use `patchSchema()` (Zod 4 keeps defaults inside `.partial()`).
- API routes: project data under `/api/projects/:projectId/...`; always query children with `{ id, projectId }`; validate referenced ids belong to the project/org; non-members → 404; use `userOf/projectOf/membershipOf(req)` instead of `!`.
- Every state-changing action writes an audit entry (`projectAudit` / `audit`) with `projectId` in metadata.
- Errors: throw `AppError` helpers from `utils/errors.ts`; never return stack traces.
- Web: features in `src/features/<domain>`; forms use shared schemas + `zodResolver`; empty `<select>` values map to `null` (`setValueAs`); UI permission checks are hints only.
- Tests: integration tests hit real PostgreSQL via `TEST_DATABASE_URL` (name must contain "test"); only the external AI vendor is replaced by a test double. E2E locators must be exact or scoped (toasts and empty states collide with substrings).
- Never weaken assertions to make tests pass; find the root cause (see the defect list in PROJECT_STATUS).
- Check-then-act on shared state must be atomic in PostgreSQL (conditional update, `FOR UPDATE`, advisory lock) and covered by a concurrency test; take timestamps after acquiring locks.
- File paths from `new URL(...)`: use `fileURLToPath`, never `.pathname` (the repo path contains non-ASCII characters and spaces).

## Token-efficient workflow

- Use `rg`/targeted reads; the module layout is predictable (`apps/api/src/modules/<domain>/<domain>.routes.ts`, `apps/web/src/features/<domain>/`).
- Summarize long command output (`| tail`, `grep -E "Tests |FAIL"`), don't paste full logs.
- Record new decisions in `docs/DECISIONS.md` and verified results in `docs/PROJECT_STATUS.md`.
