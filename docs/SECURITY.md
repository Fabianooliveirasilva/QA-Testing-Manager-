# Security

Controls implemented, how they are verified, and known gaps. Mapped loosely to OWASP Top 10 (2021).

| Risk | Controls | Verified by |
| --- | --- | --- |
| A01 Broken access control / IDOR | Org membership check on every org/project route (404 for non-members); child queries filter by `id` **and** `projectId`; cross-tenant references in payloads rejected; RBAC matrix enforced server-side; archived projects read-only; owner membership immutable | `tests/access-control.test.ts` (incl. mutation test of the membership check), `attachments.test.ts`, E2E access spec |
| A02 Cryptographic failures | Argon2id passwords; session/reset/API tokens are 256-bit random values stored only as SHA-256; `Secure` cookies required in production (config refuses otherwise); HSTS via Helmet | `auth.test.ts`, `core.test.ts` |
| A03 Injection | Prisma parameterized queries only; the single raw query uses `Prisma.sql` tagged templates; Zod validation on every input; React escapes output; API only returns JSON | `security.test.ts` (SQL/LIKE payloads, XSS stored verbatim, type manipulation, mass assignment) |
| A04 Insecure design | Execution status separate from case status; automated results immutable; AI output always a reviewable draft, never an execution result | `workflow.test.ts`, `automation.test.ts`, `ai.test.ts` |
| A05 Security misconfiguration | Helmet (CSP `default-src 'none'` on the API, nosniff, frameguard, HSTS); nginx CSP for the SPA; strict CORS allow-list with credentials; `x-powered-by` removed; errors never include stacks/SQL; env validated at boot | `security.test.ts` |
| A06 Vulnerable components | `pnpm audit --audit-level high` in CI; vulnerable transitive dev deps pinned to patched versions via `pnpm.overrides` | CI audit step (currently: no known vulnerabilities) |
| A07 Identification & auth failures | Generic login errors; uniform timing for unknown e-mails; lockout after 5 failures (15 min); per-IP rate limits on credential endpoints; sliding (12 h) + absolute (7 d) session expiry; logout deletes the server session; password reset single-use, 30 min, no user enumeration, revokes all sessions; change password revokes other sessions | `auth.test.ts` |
| A08 Integrity failures | CSRF token bound to the session for cookie-authenticated writes; report deduplication by content hash; CI tokens scoped to one project and one action | `auth.test.ts`, `automation.test.ts` |
| A09 Logging & monitoring | Pino structured logs with cookies/authorization/CSRF redacted; audit log for security-relevant and data-changing actions | `workflow.test.ts` (audit trail) |
| A10 SSRF | The server makes no user-controlled outbound requests (AI calls go to the configured vendor SDK only) | Code review |

## File uploads

Allow-list by extension; declared MIME must match; content verified by magic bytes (`file-type`) for
binary formats; text formats must be valid UTF‑8 without NUL bytes and JSON must parse; SVG/HTML are
not accepted; names are sanitized (no paths); files are stored under random keys outside the web
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
- Uploaded files are not malware-scanned (type/content validation only). Add ClamAV or a scanning service for untrusted tenants.
- Docker images and compose are not validated in this environment (Docker unavailable); CI builds the images.
