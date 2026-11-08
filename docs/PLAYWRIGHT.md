# Playwright integration

QA Testing Manager **imports** results produced by your Playwright runner. It does not run tests.

## 1. Produce a JSON report

```bash
npx playwright test --reporter=json > report.json
# or in playwright.config.ts:
#   reporter: [['list'], ['json', { outputFile: 'report.json' }]]
```

Supported format: the output of Playwright's built-in `json` reporter (`JSONReport` in
`playwright/types/testReporter.d.ts`). Validated with Playwright 1.65.

## 2. Send it

- **UI:** project → **Automation** → drop `report.json` → *Import report*.
- **CI:** create a token in project settings (admins) and call:

```bash
curl -fsS -X POST "$QTM_URL/api/automation/playwright?runName=CI%20%23$RUN&environment=ci" \
  -H "Authorization: Bearer $QTM_TOKEN" -H "Content-Type: application/json" --data-binary @report.json
```

A ready-to-copy GitHub Actions job is in
[`.github/workflows/playwright-report-upload.example.yml`](../.github/workflows/playwright-report-upload.example.yml).

## 3. What is recorded

One `TestRun` (source `PLAYWRIGHT`) plus one `AutomationExecution` per import, and one
`TestResult` per test × Playwright project.

| Playwright | QA Testing Manager |
| --- | --- |
| `status: expected` | PASSED (SKIPPED if `expectedStatus` is `skipped`) |
| `status: unexpected` | FAILED |
| `status: flaky` | PASSED with `metadata.flaky = true` (counted in `flaky`) |
| `status: skipped` | SKIPPED |
| any result `interrupted` | execution status INTERRUPTED, run ABORTED |
| result durations | summed into `durationMs` |
| last result `retry` | `retries` |
| `error.message` / `error.stack` | `errorMessage` / `errorStack` (ANSI codes stripped, 10 kB max) |
| attachments | names, content types and runner paths in metadata (files are not uploaded) |
| top-level `errors` | `reportMetadata.globalErrors` (run marked FAILED) |
| `config.version`, `stats` | `reportMetadata` |

Result title: `[project] describe > … > test`.

## 4. Linking results to test cases

Set the test case's **Automation key** and use the same value in the test:

```ts
test('valid credentials show welcome message',
  { annotation: { type: 'qtm', description: 'LOGIN-001' } },
  async ({ page }) => { /* … */ });
```

Without an annotation the key defaults to `<file> > <describe…> > <title>`, which you can also
paste as the automation key. Unmatched results are still stored (no test case link).

## 5. Duplicates and traceability

The import hash is `sha256(stats.startTime + suites)`; importing the same report twice into a
project returns **409** with the existing `testRunId`. Each execution records its source (`upload`,
`api-token:<prefix>` or `seed`) and the importing user in the audit log.

## Sample project

[`examples/playwright-sample`](../examples/playwright-sample) is a real Playwright project against a
tiny local page. It deliberately contains passing, failing, flaky (fails on first attempt) and
skipped tests so every mapping can be demonstrated:

```bash
pnpm --filter @qtm/playwright-sample exec playwright test   # writes examples/playwright-sample/report.json
```

`apps/api/tests/fixtures/playwright-report.json` is that real output (absolute paths normalized) and
is used by the unit, integration and E2E tests.

## Future: remote execution

`executionSource` and the parser are independent from the transport, so a future runner service
(e.g. a queue + sandboxed workers) can post reports into the same pipeline.
