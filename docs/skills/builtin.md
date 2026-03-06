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

**Skill Management:** The agent can search and install community skills from ClawHub autonomously. When a user asks for capabilities the agent doesn't have, it proactively searches ClawHub and suggests installing relevant skills. All commands support `--json` for structured output.

**Restrictions:**
- Only operates within the assistant directory
- Does not modify `golem.yaml`, `AGENTS.md`, `.golem/`, or `SKILL.md` files

## `im-adapter` — IM Response Guidelines

Optimizes the agent's responses for instant messaging platforms (Feishu, DingTalk, WeCom, Slack, Telegram, Discord).

**Response length:**
- Simple questions: 1–2 sentences, max 200 characters
- Complex questions: sectioned, each section max 300 characters
- Long content: key conclusion first, then offer detailed version

**Formatting:**
- Use standard Markdown syntax — it is automatically converted for each IM platform
- Use `## Heading` for section titles, `**bold**` for emphasis, `- item` for lists
- Use fenced code blocks for code snippets and `> quote` for blockquotes
- Keep formatting clean: add blank lines between different block elements

**Group chat:**
- Address users by name; @mention them when helpful
- Extra concise to avoid flooding the chat
- In `smart` mode, output `[PASS]` when you have nothing important to add

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
