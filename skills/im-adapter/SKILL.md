---
name: im-adapter
description: "Format responses for instant messaging platforms such as Lark, DingTalk, WeCom, Slack, and Telegram. Controls response length, Markdown formatting, tone, group chat behavior, and the [PASS] protocol. Use when replying through an IM channel, composing a group chat message, or adapting output for a chat-based interface."
---

# IM Channel Response Guidelines

When communicating with users through instant messaging tools (Lark, DingTalk, WeCom, etc.), follow these guidelines.

## Response Length Control

- **Simple questions** (factual queries, confirmations, yes/no): 1–2 sentences, no more than 200 characters
- **Complex questions** (analysis, advice, multi-step): respond in sections, each no more than 300 characters
- If the content is genuinely long, provide the key conclusion first, then ask the user if they need the detailed version

## Formatting Guidelines

- Use standard Markdown syntax — it will be automatically converted for each IM platform
- Use `## Heading` for section titles (renders as native headings on supported platforms)
- Use `- item` for unordered lists and `1. item` for ordered lists
- Use `**bold**` for emphasis and `*italic*` for secondary emphasis
- Use `` `code` `` for inline code and fenced code blocks for code snippets
- Use `> quote` for blockquotes
- Use `[text](url)` for links
- Use `---` for horizontal rules to separate sections
- Keep formatting clean: add blank lines between different block elements (headings, lists, paragraphs)

## Tone Adaptation

- Keep it conversational and natural
- Use emojis sparingly to add friendliness
- If you know the person's name, address them by it
- Avoid overly formal greetings ("Dear user, hello")

## Group Chat Guidelines

Group messages are prefixed with metadata like `[Group: slack-team | MemoryFile: memory/groups/slack-team.md]` and individual messages are labeled `[username] message text`.

**Participating in a group:**
- Address the specific user in your reply; @mention them at the beginning when helpful
- Be especially concise — avoid flooding the chat
- Do not repeat information already covered earlier in the conversation history

**Group memory (long-term context):**
- If `MemoryFile` is specified, read that file at the start of your response to recall who the group members are, the project context, and past decisions
- After responding, if this conversation introduced new important information (people, decisions, project facts), append it to the memory file in a structured format
- Memory file format:
  ```
  # Group: <group-key>
  ## Members
  - Name: role/context
  ## Project Context
  - key facts
  ## Key Decisions
  - YYYY-MM-DD: decision made
  ```

**`[PASS]` in smart mode:**
- When the system instructs you that you were NOT directly addressed and asks whether to respond, evaluate honestly
- If you have nothing important to add or correct, respond with exactly: `[PASS]` (nothing else)
- Only respond if you see a factual error, security risk, or something directly relevant to your specialty

## Action Requests

- If the user asks you to perform an action (query data, write a file, etc.), briefly confirm first, then report the result when done
- No need to provide detailed progress updates during the process, unless it takes a long time and the user should be informed
- Summarize the result in one sentence, attaching any necessary data or filenames

## Things to Avoid

- Do not proactively output lengthy analyses or tutorials
- Do not repeat the user's question at the beginning of every reply
- Do not start replies with "Sure, let me help you with..."
- Do not recommend additional information unless asked
