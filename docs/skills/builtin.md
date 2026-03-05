# Built-in Skills

GolemBot ships with two built-in skills that are automatically copied into new assistant directories during `golembot init` or `golembot onboard`.

## `general` — General Personal Assistant

A general-purpose skill that makes the agent a personal AI assistant.

**Capabilities:**
- Answer questions, provide suggestions, brainstorm ideas
- Read and write files: organize notes, generate reports, manage to-dos
- Execute scripts and commands for task automation
- Information retrieval and summarization

**Persistent Memory:** The `general` skill establishes a `notes.md` convention for cross-session memory — the agent reads it at conversation start and writes to it when important information comes up. See [Memory](/guide/memory) for the full specification.

**Restrictions:**
- Only operates within the assistant directory
- Does not modify `golem.yaml`, `AGENTS.md`, `.golem/`, or `SKILL.md` files

## `im-adapter` — IM Response Guidelines

Optimizes the agent's responses for instant messaging platforms (Feishu, DingTalk, WeCom).

**Response length:**
- Simple questions: 1–2 sentences, max 200 characters
- Complex questions: sectioned, each section max 300 characters
- Long content: key conclusion first, then offer detailed version

**Formatting:**
- Avoid Markdown headers, code blocks, and tables (unless explicitly requested)
- Use simple list markers (1. 2. 3. or -)
- URLs directly, not Markdown link syntax

**Group chat:**
- `[User:xxx]` prefix indicates group context
- Address users by name
- Extra concise to avoid flooding

**Tone:**
- Conversational and natural
- No overly formal greetings
- Never start with "Sure, let me help you with..."

## Template Skills

The [onboard wizard](/guide/onboard-wizard) offers 6 scenario templates, each with a specialized skill:

| Template | Skill | Key behavior |
|----------|-------|-------------|
| `customer-support` | `faq-support` | FAQ lookup from `faq.md`, escalation to `unanswered.md` |
| `data-analyst` | `data-analysis` | Reads from `data/`, outputs to `reports/`, uses `calc.py` |
| `code-reviewer` | `code-review` | 5-dimension review, severity tiers (Must/Should/Nice), outputs to `reviews/` |
| `ops-assistant` | `ops` | Content writing, scheduling via `schedule.md`, competitor tracking |
| `meeting-notes` | `meeting` | Structured minutes, action items in `action-items.md`, archived to `meetings/` |
| `research` | `research` | Research reports with tables, sources in `sources.md`, archived to `research/` |
