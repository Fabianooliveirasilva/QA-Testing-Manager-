# AI test assistant

## Features

- **Test case generation** from requirements/user stories → positive, negative, edge-case and
  regression cases with steps; selected suggestions are saved as **DRAFT** test cases flagged
  `aiGenerated` (shown with an *AI* badge).
- **Playwright suggestions** → TypeScript `@playwright/test` files (resilient locators, web-first
  assertions, optional Page Object Model) to copy into your repository.
- **Bug analysis** → possible causes, missing information, reproduction suggestions, suggested
  severity/priority with rationale.

The assistant never creates or changes execution results.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `none` | `anthropic` to enable the Claude adapter |
| `ANTHROPIC_API_KEY` | – | Required when `AI_PROVIDER=anthropic` |
| `AI_MODEL` | `claude-opus-5-5` | Model id for the adapter |
| `AI_DAILY_LIMIT_PER_USER` | `50` | Requests per user per UTC day |

With no provider configured the API answers `503` and the UI explains how to configure it — the
rest of the product is unaffected. After configuring the server, an **organization admin** must
enable the assistant in *Settings* (off by default) because user-entered text is sent to the vendor.

## Safety rules implemented

- Organization opt-in + per-user daily quota (`ai_requests` table also records usage for transparency).
- Redaction before sending: e-mails, API keys, GitHub/AWS tokens, JWTs, bearer tokens, private keys,
  `password=`/`token=` pairs.
- User input is wrapped in `<input>` tags and the system prompt instructs the model to treat it as
  data (prompt-injection mitigation).
- Structured output: the adapter requests JSON matching a Zod schema (SDK structured outputs) and
  the response is validated again locally; invalid output → `502 AI_INVALID_OUTPUT`, refusal → `422`,
  vendor rate limit → `429`, outage/credentials → `503`.
- Results are labelled with provider and model in the API (`aiGenerated: true`) and UI.

## Adding another provider

Implement `AiProvider` (`apps/api/src/modules/ai/ai.provider.ts`) using the vendor's official SDK,
validate output with the given `schema`, map vendor errors to `AiProviderError`, and register it in
`createAiProvider`.

## Verification status

The service logic (opt-in, quota, redaction, validation, error mapping, provenance) is covered by
`apps/api/tests/ai.test.ts` with a test double for the vendor. **A live call to Anthropic was not
executed** in this environment because no API key is configured — treat the Claude adapter as a
configuration dependency until verified with real credentials.
