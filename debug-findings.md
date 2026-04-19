# Debug Findings: Messages Not Being Processed

**Date:** 2026-04-19
**Symptom:** wa-agent connects to WhatsApp successfully but never replies to incoming messages. Zero message-related log entries despite the listener being started.

---

## Root Cause: Missing `~/.wu/config.yaml`

The wu-cli library (`@ibrahimwithi/wu-cli`) uses a constraint system to control which chats are collected and processed. The config is loaded from `~/.wu/config.yaml`.

**When this file does not exist**, the `constraints` field is `undefined`. The constraint resolver in `node_modules/@ibrahimwithi/wu-cli/dist/core/constraints.js` treats this as "block everything":

```javascript
// constraints.js
export function resolveConstraint(jid, config) {
    if (!config.constraints)
        return "none";   // ← ALL chats default to "none" (blocked)
    // ...
}

export function shouldCollect(jid, config) {
    const mode = resolveConstraint(jid, config);
    return mode !== "none";  // ← returns false for every JID
}
```

In the listener (`listener.js`), every incoming message is checked against this:

```javascript
// listener.js — inside messages.upsert handler
for (const msg of messages) {
    // ...
    if (!shouldCollect(jid, config)) continue;  // ← skips ALL messages
    // ...
    if (type === "notify" && opts.onMessage) {
        opts.onMessage(parsed);  // ← never reached
    }
}
```

**Result:** Every message is silently dropped before reaching the `onMessage` callback. The agent's router, middleware, and LLM logic never execute.

---

## Fix

Created `~/.wu/config.yaml` with:

```yaml
constraints:
  default: full
  chats: {}
```

This sets the default constraint mode to `full` (read + write + manage), allowing all chats to be collected and processed. Individual chats can be restricted later by adding entries under `chats:`.

### Constraint modes

| Mode   | Behavior                                      |
|--------|-----------------------------------------------|
| `full` | Read, write, and manage — full access          |
| `read` | Messages are collected but sending is blocked  |
| `none` | Messages are silently dropped                  |

### Managing constraints via CLI

```bash
wu config allow <jid>              # Set a chat to "full"
wu config allow <jid> --mode read  # Set a chat to "read-only"
wu config block <jid>              # Set a chat to "none"
wu config remove <jid>             # Remove override, fall back to default
wu config default full             # Set the default mode
wu config constraints              # Show all constraints
```

---

## Secondary Issue: Missing Anthropic API Key in PM2

The agent config (`agents/default.yaml`) uses `provider: anthropic`, but `ecosystem.config.cjs` does not include `ANTHROPIC_API_KEY` in its `env` section. Once messages start flowing, the LLM call will fail unless the key is added:

```javascript
// ecosystem.config.cjs
env: {
    NODE_ENV: 'production',
    ANTHROPIC_API_KEY: '<your-key>',      // ← add this
    ANTHROPIC_BASE_URL: '<your-proxy>',   // ← if using a proxy
    // ...
},
```

After making changes, restart with `pm2 restart wa-agent`.
