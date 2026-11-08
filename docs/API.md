# API reference

Base path: `/api`. JSON in/out unless noted. Input contracts are the Zod schemas in
[`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts) (field limits, enums, defaults).

## Conventions

**Authentication.** Cookie session (`qtm_session`, HttpOnly). Obtain it via `register`/`login`.
**CSRF.** Every `POST`/`PATCH`/`DELETE` made with a session must send header `x-csrf-token` with the
value of the `qtm_csrf` cookie (also returned by `GET /auth/me`).
**CI token.** `POST /automation/playwright` only: `Authorization: Bearer qtm_…` (no cookie/CSRF).

**Errors** always use this envelope (no stack traces):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request data", "details": [{ "path": "title", "message": "Too small" }] } }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `INVALID_PASSWORD` | Invalid input / reference to a resource outside the project |
| 401 | `UNAUTHORIZED` | No/expired session, wrong credentials or locked account (same message) |
| 403 | `FORBIDDEN` | Role lacks permission, CSRF failure, archived project, AI disabled for the org, registration disabled |
| 404 | `NOT_FOUND` | Unknown id **or** resource in an organization you do not belong to |
| 409 | `CONFLICT` | Unique constraint, closed run, plan with runs, duplicate report (`details` has the existing ids) |
| 413 | `PAYLOAD_TOO_LARGE`, `UPLOAD_ERROR` | JSON > 1 MB, file > 10 MB, report > 20 MB |
| 415 | `UNSUPPORTED_FILE` | File type not allowed or content does not match |
| 422 | `INVALID_REPORT`, `AI_REFUSAL`, `MALWARE_DETECTED` | Not a Playwright JSON report / AI provider declined / file rejected by the configured scanner |
| 429 | `TOO_MANY_REQUESTS`, `AI_RATE_LIMITED` | Rate limit, or daily AI quota (per user or per organization) |
| 500 | `INTERNAL_ERROR` | Unexpected error; body includes `requestId` for log correlation |
| 502 / 503 | `AI_INVALID_OUTPUT` / `SERVICE_UNAVAILABLE` | AI returned an invalid structure / AI not configured or unavailable |

**Correlation.** Every response has an `X-Request-Id` header (a well-formed incoming value is reused,
otherwise one is generated).

**Pagination.** List endpoints that paginate accept `page` (≥1) and `pageSize` (1–100) and return
`{ items, total, page, pageSize }`.

**Roles.** V = Viewer, M = Member, A = Admin/Owner. "M+" means Member, Admin and Owner.

## Auth — `/auth`

| Method & path | Body | Notes |
| --- | --- | --- |
| `POST /auth/register` | `name, email, password, organizationName` | 201; creates user + organization (Owner) + session. Rate limited. 403 when `REGISTRATION_ENABLED=false`. |
| `POST /auth/login` | `email, password` | 200; 5 failures lock the account 15 min. Rate limited per IP. |
| `POST /auth/logout` | – | 204; deletes the session. |
| `POST /auth/logout-all` | – | 204; deletes all sessions of the user. |
| `GET /auth/me` | – | `{ user, csrfToken, organizations[{ id, name, slug, aiEnabled, role }] }` |
| `POST /auth/forgot-password` | `email` | Always 202 (no user enumeration). Link valid 30 min, single use. |
| `POST /auth/reset-password` | `token, password` | 204; revokes every session. |
| `POST /auth/change-password` | `currentPassword, newPassword` | 204; revokes other sessions. |

## Organizations — `/organizations`

| Method & path | Role | Notes |
| --- | --- | --- |
| `GET /organizations` · `POST /organizations {name}` | any | List mine / create (caller becomes Owner) |
| `GET /organizations/:orgId` · `PATCH {name?, aiEnabled?}` | V · A | `aiEnabled` is the AI opt-in |
| `GET /organizations/:orgId/members` | V | |
| `POST /organizations/:orgId/members {email, role}` | A | Existing users only; role ≠ OWNER |
| `PATCH /organizations/:orgId/members/:memberId {role}` · `DELETE` | A | Owner cannot be changed/removed; not your own role |
| `GET /organizations/:orgId/projects?status=` · `POST {name, description?, leadId?}` | V · A | New projects get a "General" suite |
| `GET /organizations/:orgId/dashboard?projectId=` | V | Totals, 30‑day result counts & pass rate, 14‑day history, bugs by severity, recent runs, activity |
| `GET /organizations/:orgId/search?q=` | V | Projects, test cases, bugs (min 2 chars) |
| `GET /organizations/:orgId/audit-logs` | A | Paginated |
| `GET /organizations/:orgId/ai/status` | V | `{ configured, provider, model, enabledForOrganization, dailyLimit, usedToday, organizationDailyLimit, organizationUsedToday }` |
| `POST /organizations/:orgId/ai/test-cases {requirement, context?}` | M+ | `{ aiGenerated: true, provider, model, result: { testCases[] } }` |
| `POST /organizations/:orgId/ai/playwright {scenario, baseUrl?, usePageObjects}` | M+ | `result: { files[{path, content}], notes }` |
| `POST /organizations/:orgId/ai/bug-analysis {description}` | M+ | `result: { possibleCauses, missingInformation, reproductionSuggestions, suggestedSeverity, suggestedPriority, rationale }` |

## Projects — `/projects/:projectId`

Writes on an **archived** project return 403 (except unarchive).

| Method & path | Role | Notes |
| --- | --- | --- |
| `GET /` · `PATCH {name?, description?, leadId?}` | V · A | `GET` includes counts and your `role` |
| `POST /archive` · `POST /unarchive` | A | |
| `GET /metrics` | V | Dashboard metrics scoped to the project |
| `GET /members` · `POST {userId}` · `DELETE /members/:userId` | V · A | Project team (must be org members) |
| `GET /suites` · `POST {name, description?}` | V · M+ | Unique name per project |
| `PATCH /suites/:suiteId` · `DELETE` | M+ · A | Delete only when the suite never held cases |
| `GET /tokens` · `POST {name}` · `DELETE /tokens/:tokenId` | A | CI tokens; secret returned **once** on creation; delete = revoke |

### Test cases — `/projects/:projectId/test-cases`

| Method & path | Role | Notes |
| --- | --- | --- |
| `GET /?q&suiteId&priority&type&status&tag&sort&order&page&pageSize` | V | `sort`: title, priority, createdAt, updatedAt |
| `POST /` | M+ | `testCaseCreateSchema` (steps ordered by array position; tags lower-cased & unique) |
| `GET /:caseId` | V | Includes steps and the last 10 executions |
| `PATCH /:caseId` | M+ | Partial; `steps` replaces all steps atomically |
| `POST /:caseId/duplicate` | M+ | Copy as DRAFT without automation key |
| `DELETE /:caseId` | M+ | Soft delete; removed from DRAFT/ACTIVE plans |

### Test plans — `/projects/:projectId/test-plans`

| `GET /` · `POST {name, description?, scope?, environment?, status?, suiteIds[], testCaseIds[]}` | V · M+ | Suites expand to their non-deprecated cases |
| --- | --- | --- |
| `GET /:planId` | V | Cases and runs with summaries |
| `PATCH /:planId` | M+ | Passing `suiteIds`/`testCaseIds` replaces the case set |
| `DELETE /:planId` | M+ | 409 if the plan has runs |

### Test runs — `/projects/:projectId/test-runs`

| `GET /?source=MANUAL\|PLAYWRIGHT&page` | V | Each item has `summary` (counts per status) and `passRate` |
| --- | --- | --- |
| `POST {testPlanId, name, environment?}` | M+ | Creates NOT_RUN results for each active case; plan DRAFT → ACTIVE |
| `GET /:runId` | V | Results with case steps, errors, bug counts; `automation` for imports |
| `PATCH /:runId/results/:resultId {status, actualResult?, notes?, durationSeconds?}` | M+ | Manual, in-progress runs only (409 otherwise) |
| `POST /:runId/complete` · `POST /:runId/abort` | M+ | Closes the run |

**Pass rate** = PASSED ÷ (PASSED + FAILED + BLOCKED) × 100, one decimal; `null` when the denominator is 0.

### Bugs — `/projects/:projectId/bugs`

| `GET /?q&status&severity&assigneeId&page` | V | |
| --- | --- | --- |
| `POST /` | M+ | `bugCreateSchema`; `testCaseId`/`testResultId` must belong to the project |
| `GET /:bugId` | V | Includes links and history |
| `PATCH /:bugId` | M+ | Partial; every changed field is written to history |
| `DELETE /:bugId` | A | Also deletes its evidence files |

### Attachments — `/projects/:projectId/attachments`

| `GET /?entityType=TEST_CASE\|TEST_RESULT\|BUG&entityId=` | V | |
| --- | --- | --- |
| `POST /` (multipart: `file`, `entityType`, `entityId`) | M+ | ≤ 10 MB; png, jpg/jpeg, webp, pdf, txt, log, json; content-validated; response includes `scanStatus` (`NOT_SCANNED` / `CLEAN`) |
| `GET /:attachmentId/download[?inline=1]` | V | `Content-Disposition: attachment` (inline only for images), `nosniff`, sandbox CSP |
| `DELETE /:attachmentId` | M+ | |

### Automation — `/projects/:projectId/automation`

| `GET /` · `GET /:executionId` | V | Import history |
| --- | --- | --- |
| `POST /playwright` (multipart: `report`, `runName?`, `environment?`) | M+ | 201 `AutomationExecution`; 409 duplicate; 422 not a report |

## CI import — `POST /automation/playwright`

`Authorization: Bearer qtm_…`, `Content-Type: application/json`, body = raw report (≤ 20 MB).
Query: `runName`, `environment`. The token's creator must still be a non-viewer member; revoked
tokens and archived projects are rejected. Response as above.

## Health

| Endpoint | Meaning |
| --- | --- |
| `GET /health/live` | Process is up (no dependencies). |
| `GET /health/ready` (alias `GET /health`) | `{ status: "ok", checks: { database: "ok" } }`, or **503** `{ status: "unavailable", … }` when PostgreSQL is unreachable. |
