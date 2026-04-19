# OpenRouter Provider — Test Findings

**Date:** 2026-04-19
**Tested by:** Claude (automated)

---

## Summary

Two issues were found when switching to OpenRouter:

1. **Bug (fixed): Responses API vs Chat Completions API** — `@ai-sdk/openai` v3+ defaults to the Responses API (`/v1/responses`), but OpenRouter only supports Chat Completions (`/v1/chat/completions`). Fixed by using `provider.chat()` instead of `provider()`.

2. **Config: Model ID format** — OpenRouter uses `provider/model-name` IDs (e.g., `anthropic/claude-sonnet-4`), not Anthropic-style IDs (e.g., `claude-sonnet-4-20250514`).

---

## Bug: Responses API Error (FIXED)

### Symptom

```
AI_APICallError: Invalid Responses API request
url: https://openrouter.ai/api/v1/responses
```

The SDK was sending requests to `/v1/responses` (OpenAI Responses API format), but OpenRouter only supports `/v1/chat/completions`.

### Root Cause

In `@ai-sdk/openai` v3.0.41, calling `provider(modelId)` returns a model that uses the **Responses API** by default. OpenRouter doesn't implement this endpoint.

### Fix Applied

**File:** `src/agent/factory.ts`, line 22

```diff
 case 'openrouter': {
   const provider = createOpenAI({
     baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
     apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
   });
-  return provider(config.model);
+  return provider.chat(config.model);
 }
```

`provider.chat()` forces the Chat Completions API (`/v1/chat/completions`), which is what OpenRouter supports.

### Verification

Tested with `deepseek/deepseek-r1-0528` (the model from the error log) with multi-turn messages + tools — the exact scenario that was failing. Result: **PASSED**.

---

## Issue: Model ID Format Mismatch

The current `default.yaml` uses Anthropic's model ID format:
```yaml
model: claude-sonnet-4-20250514   # Anthropic direct API format
```

OpenRouter uses a **different naming convention** (`provider/model-name`). The equivalent is:
```yaml
model: anthropic/claude-sonnet-4  # OpenRouter format
```

Date-stamped IDs like `claude-sonnet-4-20250514` or `anthropic/claude-sonnet-4-20250514` are **not recognized** by OpenRouter.

### Test Results

| # | Test | Result |
|---|------|--------|
| 1 | `anthropic/claude-sonnet-4` (valid OpenRouter ID) | **PASSED** |
| 2 | `claude-sonnet-4-20250514` (Anthropic-style ID) | **FAILED** — "not a valid model ID" |
| 3 | `anthropic/claude-sonnet-4-20250514` (date-stamped) | **FAILED** — "not a valid model ID" |
| 4 | API key via `process.env.OPENROUTER_API_KEY` (no explicit apiKey) | **PASSED** |
| 5 | Full YAML config simulation (provider + model + temperature + maxTokens) | **PASSED** |
| 6 | Multi-turn + tools with `deepseek/deepseek-r1-0528` (post-fix) | **PASSED** |

### Available Claude Models on OpenRouter

| OpenRouter Model ID | Description |
|---|---|
| `anthropic/claude-opus-4.7` | Claude Opus 4.7 (latest) |
| `anthropic/claude-opus-4.6` | Claude Opus 4.6 |
| `anthropic/claude-sonnet-4.6` | Claude Sonnet 4.6 |
| `anthropic/claude-opus-4.5` | Claude Opus 4.5 |
| `anthropic/claude-sonnet-4.5` | Claude Sonnet 4.5 |
| `anthropic/claude-haiku-4.5` | Claude Haiku 4.5 |
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

The `OPENROUTER_API_KEY` env var is already set in `ecosystem.config.cjs`. The factory code picks it up via `config.apiKey ?? process.env.OPENROUTER_API_KEY`.

---

## Note

The `test-openrouter.ts` file in the project root uses an invalid model ID (`anthropic/claude-sonnet-4-20250514`). It should be updated to `anthropic/claude-sonnet-4`.
