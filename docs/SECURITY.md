# Security

Controls implemented, how they are verified, and known gaps. Mapped loosely to OWASP Top 10 (2021).

| Risk | Controls | Verified by |
| --- | --- | --- |
| A01 Broken access control / IDOR | Org membership check on every org/project route (404 for non-members); child queries filter by `id` **and** `projectId`; cross-tenant references in payloads rejected; RBAC matrix enforced server-side; archived projects read-only; owner membership immutable | `tests/access-control.test.ts` (incl. mutation test of the membership check), `attachments.test.ts`, E2E access spec |
| A02 Cryptographic failures | Argon2id passwords; session/reset/API tokens are 256-bit random values stored only as SHA-256; `Secure` cookies required in production (config refuses otherwise); HSTS via Helmet | `auth.test.ts`, `core.test.ts` |
| A03 Injection | Prisma parameterized queries only; the single raw query uses `Prisma.sql` tagged templates; Zod validation on every input; React escapes output; API only returns JSON | `security.test.ts` (SQL/LIKE payloads, XSS stored verbatim, type manipulation, mass assignment) |
| A04 Insecure design | Execution status separate from case status; automated results immutable; closed runs immutable under concurrency (row lock); AI output always a reviewable draft; AI quotas reserved atomically (per user and per organization) | `workflow.test.ts`, `automation.test.ts`, `ai.test.ts` (concurrency tests) |
| A05 Security misconfiguration | Helmet (CSP `default-src 'none'` on the API, nosniff, frameguard, HSTS); nginx CSP for the SPA; strict CORS allow-list with credentials; `x-powered-by` removed; errors never include stacks/SQL; env validated at boot | `security.test.ts` |
| A06 Vulnerable components | `pnpm audit --audit-level high` in CI; vulnerable transitive dev deps pinned to patched versions via `pnpm.overrides` | CI audit step (currently: no known vulnerabilities) |
| A07 Identification & auth failures | Generic login errors; uniform timing for unknown e-mails **and locked accounts**; lockout after 5 failures (15 min); per-IP rate limits on credential endpoints; sliding (12 h) + absolute (7 d) session expiry; logout deletes the server session; password reset single-use (claimed atomically — concurrent reuse fails), 30 min, no user enumeration, revokes all sessions; departing members lose CI tokens they created; change password revokes other sessions | `auth.test.ts` |
| A08 Integrity failures | CSRF token bound to the session for cookie-authenticated writes; report deduplication by content hash; CI tokens scoped to one project and one action | `auth.test.ts`, `automation.test.ts` |
| A09 Logging & monitoring | Pino structured logs with cookies/authorization/CSRF redacted and no request bodies; `X-Request-Id` correlation (validated, nginx-generated); 500 responses carry the request id; audit log for security-relevant actions (incl. malware rejections, member removal cleanup); liveness/readiness endpoints | `operations.test.ts`, `workflow.test.ts`, `mailer.test.ts` |
| A10 SSRF | The server makes no user-controlled outbound requests (AI calls go to the configured vendor SDK only) | Code review |

## File uploads

Allow-list by extension; declared MIME must match; content verified by magic bytes (`file-type`) for
binary formats; text formats must be valid UTF‑8 without NUL bytes and JSON must parse; SVG/HTML are
not accepted; every file passes through a `FileScanner` hook — infected verdicts are rejected (422) and
audited, and each attachment records `scanStatus` (`NOT_SCANNED` when no engine is configured, which is
the default: **no malware engine is bundled**); names are sanitized (no paths); files are stored under random keys outside the web
root with `0600`; downloads are `attachment` (images may be `inline`) with `nosniff` and a sandbox
CSP. Limits: 10 MB per file, 1 file per request.

## Secrets & configuration

- Secrets only via environment variables; `.env*` is git-ignored (`.env.example` / `.env.docker.example` contain placeholders).
- Docker: the API runs as the unprivileged `node` user; the database user for the running API has
  DML-only privileges; migrations use the schema-owner role (`infrastructure/postgres/10-app-role.sh`).
- AI: data is only sent to a provider when the server is configured **and** an org admin opted in;
  prompts are redacted (emails, API keys, tokens, JWTs, private keys, `password=` pairs).

## Known gaps / follow-ups

- No transactional e-mail provider: reset links are logged in development and **not delivered in
  production** until an SMTP/API mailer implementing `Mailer` is configured.
- No MFA / SSO; no email verification on sign-up; members must already have an account (no invitations).
- Rate limits are in-memory (per process). Use a shared store (e.g. Redis) when running multiple API replicas.
- No malware engine is bundled: uploads are marked `NOT_SCANNED`. Implement `FileScanner` (e.g. ClamAV daemon) for untrusted tenants.
- No admin-initiated password reset; with no mail provider, a user who forgets their password cannot recover access.
- Login lockout is per account, so an attacker who knows an e-mail can lock that account for 15 minutes (accepted trade-off vs. brute force; mitigated by per-IP rate limits).
- Registration returns 409 for an existing e-mail (account enumeration on sign-up, rate limited); set `REGISTRATION_ENABLED=false` for private instances.
- Redaction regexes are quadratic on adversarial input but bounded (~70 ms worst case for the 8 kB limit).

## Round-2 audit (2026-11-08)

Findings verified with failing tests before fixing (details in PROJECT_STATUS):

| Severity | Finding | Fix |
| --- | --- | --- |
| HIGH | Password-reset token could be redeemed twice by concurrent requests | Atomic conditional claim inside the transaction |
| HIGH | AI daily quota bypassable with concurrent requests (8/8 succeeded with limit 3) → unbounded paid usage | Quota reserved under a per-organization advisory lock; new organization limit |
| MEDIUM | Results could be written after a run was completed; a run could be closed several times | Row lock (`SELECT … FOR UPDATE`) shared by result writes and close |
| MEDIUM | Removed members stayed project lead/assignee; their CI tokens were only rejected at use time | Cleanup and token revocation in the removal transaction |
| MEDIUM | AI refusals/truncated output surfaced as generic 503 (SDK parse error raised before `stop_reason` check) | `messages.create` + explicit stop-reason handling + local parse/validation |
| MEDIUM | nginx dropped security headers on `/assets/*` (add_header inheritance) and duplicated X-Frame-Options on API responses | Shared header snippet per SPA location; API headers from Helmet only |
| LOW | Locked accounts answered ~10× faster (timing oracle) | Dummy Argon2 verification on the locked path |
| LOW | Production could start with localhost `APP_URL`/`WEB_ORIGIN` defaults (broken reset links/CORS) | Explicit values required when `NODE_ENV=production` |
| LOW | AI worst-case latency (120 s × 3 attempts) exceeded the proxy timeout | 60 s × 2 attempts |
