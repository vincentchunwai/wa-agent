# OpenRouter Provider — Test Findings

**Date:** 2026-04-19
**Tested by:** Claude (automated)

---

## Summary

The OpenRouter provider implementation in `src/agent/factory.ts` works correctly. Switching `default.yaml` from Anthropic to OpenRouter **is possible** but requires changing the **model ID format** — this is the only catch.

---

## Test Results

| # | Test | Result |
|---|------|--------|
| 1 | `anthropic/claude-sonnet-4` (valid OpenRouter ID) | **PASSED** — Response received |
| 2 | `claude-sonnet-4-20250514` (Anthropic-style ID, no prefix) | **FAILED** — "not a valid model ID" |
| 3 | `anthropic/claude-sonnet-4-20250514` (date-stamped with prefix) | **FAILED** — "not a valid model ID" |
| 4 | API key via `process.env.OPENROUTER_API_KEY` (no explicit `apiKey` in config) | **PASSED** — Fallback works |
| 5 | Full simulated YAML config (provider + model + temperature + maxTokens) | **PASSED** — All params applied |

---

## Key Finding: Model ID Mismatch

The current `default.yaml` uses Anthropic's model ID format:
```yaml
model: claude-sonnet-4-20250514   # Anthropic direct API format
```

OpenRouter uses a **different naming convention** (`provider/model-name`). The equivalent is:
```yaml
model: anthropic/claude-sonnet-4  # OpenRouter format
```

Date-stamped IDs like `claude-sonnet-4-20250514` or `anthropic/claude-sonnet-4-20250514` are **not recognized** by OpenRouter.

### Available Claude Models on OpenRouter

| OpenRouter Model ID | Description |
|---|---|
| `anthropic/claude-opus-4.7` | Claude Opus 4.7 (latest) |
| `anthropic/claude-opus-4.6` | Claude Opus 4.6 |
| `anthropic/claude-opus-4.6-fast` | Claude Opus 4.6 (fast mode) |
| `anthropic/claude-sonnet-4.6` | Claude Sonnet 4.6 |
| `anthropic/claude-opus-4.5` | Claude Opus 4.5 |
| `anthropic/claude-sonnet-4.5` | Claude Sonnet 4.5 |
| `anthropic/claude-haiku-4.5` | Claude Haiku 4.5 |
| `anthropic/claude-opus-4.1` | Claude Opus 4.1 |
| `anthropic/claude-opus-4` | Claude Opus 4 |
| `anthropic/claude-sonnet-4` | Claude Sonnet 4 |
| `anthropic/claude-3.7-sonnet` | Claude 3.7 Sonnet |
| `anthropic/claude-3.5-haiku` | Claude 3.5 Haiku |

---

## How to Switch default.yaml to OpenRouter

Change `agents/default.yaml` from:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  temperature: 0.7
  maxTokens: 4096
```

To:

```yaml
llm:
  provider: openrouter
  model: anthropic/claude-sonnet-4
  temperature: 0.7
  maxTokens: 4096
```

### API Key Configuration

The `OPENROUTER_API_KEY` env var must be set. Two options:

1. **Via ecosystem.config.cjs** (already configured):
   ```js
   env: {
     OPENROUTER_API_KEY: 'sk-or-v1-...',
   }
   ```

2. **Via YAML `apiKey` field** (alternative, supports env var interpolation):
   ```yaml
   llm:
     provider: openrouter
     model: anthropic/claude-sonnet-4
     apiKey: "${OPENROUTER_API_KEY}"
   ```

Both methods work — the factory code checks `config.apiKey ?? process.env.OPENROUTER_API_KEY`.

---

## Code Review

### factory.ts — OpenRouter provider path (lines 17–23)

```typescript
case 'openrouter': {
  const provider = createOpenAI({
    baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
    apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
  });
  return provider(config.model);
}
```

- Reuses `@ai-sdk/openai` with OpenRouter's base URL — correct approach.
- Falls back to env var if no explicit `apiKey` — good.
- Custom `baseUrl` override supported — good for proxies.
- No OpenRouter-specific headers (e.g., `HTTP-Referer`, `X-Title`) are set. These are optional but recommended by OpenRouter for app identification and ranking in their leaderboards.

### schema.ts — Validation (line 6)

```typescript
provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama']),
```

`openrouter` is a valid enum value — config validation will pass.

---

## Potential Improvement

The `test-openrouter.ts` file in the project root uses an invalid model ID (`anthropic/claude-sonnet-4-20250514`). It should be updated to `anthropic/claude-sonnet-4` to pass.

---

## Conclusion

The refactored code supports OpenRouter correctly. The only action needed to switch is updating the `model` field in the YAML to use OpenRouter's model ID format. No code changes required.
