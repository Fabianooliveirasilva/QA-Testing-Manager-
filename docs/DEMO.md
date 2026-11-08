# Demo script (~10 minutes)

Setup: `pnpm db:start`, `pnpm db:deploy`, `pnpm db:seed`, `pnpm dev:api`, `pnpm dev:web`, open
http://localhost:5173 and sign in as `owner@demo.qtm.local` (password in the README).

1. **Dashboard** — all figures come from the seeded data: 1 manual run + 1 imported Playwright run.
   Point out the pass-rate definition under the card and the project filter.
2. **Projects → Sample Login App** — suites, team, lead, CI tokens (create one; it is shown once).
3. **Test cases** — search "login", filter by priority, click a tag, open a case: steps, recent
   executions (manual and Playwright), automation key `LOGIN-001`. Duplicate it.
4. **Test plans → Release 1.0 regression → Start manual run** — Pass/Fail/Block/Skip, add notes and
   upload a screenshot to a failed result, then **Report bug** (pre-linked to the result).
5. **Bugs** — change status, see field-level history, upload evidence; try uploading a `.html` or a
   text file renamed to `.png` → rejected.
6. **Automation** — show the import history; run the sample project and upload its report:
   `pnpm --filter @qtm/playwright-sample exec playwright test` → upload
   `examples/playwright-sample/report.json` → run page with failed/flaky/skipped details and stack
   traces. Upload it again → "already imported".
7. **Access control** — sign in as `viewer@demo.qtm.local`: no create/edit buttons; API also returns 403.
8. **Settings** — members & roles, AI opt-in toggle, audit log.
9. **AI Assistant** — without credentials the page explains that it is not configured (no data leaves
   the server). With `AI_PROVIDER=anthropic` and a key, enable it in Settings and generate test cases
   from a user story; save selected ones as DRAFT (badge "AI").
