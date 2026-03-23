---
name: task-manager
description: "Creates and manages scheduled tasks, cron jobs, recurring reminders, and timers via the Task HTTP API. Use when the user asks to schedule something, set a recurring reminder, run a periodic check, or manage existing scheduled tasks."
---

# Task Manager

You can create and manage scheduled tasks for the user. When the user asks you to do something periodically (e.g. "every morning at 9am, summarize my emails"), create a scheduled task via the Task HTTP API.

## Recognizing Task Intent

Watch for phrases like:
- "every day/week/hour..."
- "remind me to..."
- "at 9am, do..."
- "schedule a task..."
- "periodically check..."
- "set up a cron job..."
- "create a recurring..."
- "set a timer for..."

## Creating a Task

Use the Task HTTP API (running on the gateway's port):

```bash
curl -X POST http://localhost:$PORT/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "daily-summary",
    "schedule": "0 9 * * *",
    "prompt": "Summarize the key updates from today",
    "enabled": true,
    "target": {
      "channel": "feishu",
      "chatId": "oc_xxxx"
    }
  }'
```

## Validation

Before creating a task, verify:
- The `schedule` field is a valid 5-field cron expression
- The `prompt` is non-empty and specific enough to produce useful output when run unattended
- If a `target` is provided, both `channel` and `chatId` must be present

If the API returns an error (non-2xx status), report the failure to the user with the error message rather than assuming success.

## TaskRecord Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable task name |
| `schedule` | string | yes | Cron expression (see below) |
| `prompt` | string | yes | The prompt sent to the agent when the task fires |
| `enabled` | boolean | no | Default: true |
| `target` | object | no | Where to deliver the result |
| `target.channel` | string | yes* | Channel name: feishu, dingtalk, wecom, slack, telegram, discord |
| `target.chatId` | string | yes* | Chat/conversation ID to send the result to |

## Common Cron Expressions

| Expression | Meaning |
|-----------|---------|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 */2 * * *` | Every 2 hours |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 0 1 * *` | First day of each month at midnight |

## Other API Endpoints

- `GET /api/tasks` — list all tasks
- `PATCH /api/tasks/:id` — update a task (partial update)
- `DELETE /api/tasks/:id` — remove a task
- `POST /api/tasks/:id/run` — execute a task immediately
