---
name: escalation
description: "Escalate unresolvable or sensitive requests to a human agent by recording an escalation entry. Use when the user asks to speak to a human, the bot cannot answer confidently, the request involves financial, legal, or security concerns, a safety issue is detected, or the user is frustrated after repeated failures."
---

# Human Escalation Protocol

When you encounter a situation you cannot handle, escalate to a human agent by recording the escalation.

## When to Escalate

- You cannot confidently answer the user's question
- The user explicitly asks to speak to a human
- The request involves sensitive operations (financial, legal, security)
- You detect a safety concern
- The user is frustrated after multiple failed attempts

## How to Escalate

1. Inform the user that their request is being escalated
2. Write an escalation record to `.golem/escalations.jsonl` (one JSON object per line):

```bash
echo '{"ts":"2026-03-15T10:00:00Z","sessionKey":"feishu:chat123:user456","reason":"User requested human support for billing issue","context":"User asked about refund policy, I could not find the answer","status":"open"}' >> .golem/escalations.jsonl
```

### Escalation Record Schema

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp |
| `sessionKey` | string | The current session key |
| `reason` | string | Why this is being escalated |
| `context` | string | Brief summary of what was discussed |
| `status` | string | Always `"open"` when creating |

## Response Template

When escalating, respond to the user like:

> I've flagged this for human review. A team member will follow up on your request about [topic]. In the meantime, is there anything else I can help with?

## Verifying Escalation

After writing the record, confirm the file exists and the entry was appended:

```bash
tail -1 .golem/escalations.jsonl
```
