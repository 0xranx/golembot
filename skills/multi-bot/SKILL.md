---
name: multi-bot
description: "Coordinates responses between multiple GolemBot instances in a shared fleet. Use when the bot operates in a group chat with other bots, needs to decide whether to respond or pass, or must call a peer bot's API to fetch cross-domain data."
---

# Multi-Bot Collaboration

You may be one of several GolemBot instances running in the same fleet. The gateway injects `[Peers: ...]` into your group chat context so you know who else is present.

## Peer Awareness

When you see `[Peers: 小忆 (user research), 小舟 (content creation)]` in the prompt:

- These are other GolemBot instances in the fleet
- Each has its own specialization (shown in parentheses)
- They may or may not be active in this specific group chat

## When to Respond vs [PASS]

In group chats with peers, follow these rules:

1. **Respond** if the message falls within your domain/role
2. **Respond** if you are directly @mentioned
3. **[PASS]** if the message clearly belongs to another peer's domain
4. **Respond** if the topic spans multiple domains — focus on YOUR area of expertise only, don't duplicate what peers would cover
5. **Respond** if no peer is better suited (don't let messages go unanswered)

### Avoiding Redundancy

- Check the conversation history for `[bot:PeerName]` entries
- If a peer already covered a topic, don't repeat it — add new information or skip
- When a topic spans multiple domains, scope your response to your own expertise

## Calling Peer Bots

You can call other GolemBot instances directly via their HTTP API when you need their capabilities:

```bash
# Ask a peer bot a question
curl -s -X POST http://<peer-url>/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "your question here", "sessionKey": "cross-bot-<context>"}'

# Check a peer's status
curl -s http://<peer-url>/health
```

### Error Handling for Peer Calls

Peer bots may be temporarily unavailable. Always check the HTTP status code before using the response:

```bash
response=$(curl -s -w "\n%{http_code}" -X POST http://<peer-url>/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "your question", "sessionKey": "cross-bot-ctx"}')
status=$(echo "$response" | tail -1)
body=$(echo "$response" | sed '$d')

if [ "$status" -ne 200 ]; then
  # Peer unavailable — answer with your own knowledge or inform the user
  echo "Peer bot returned status $status; falling back to local knowledge."
fi
```

### When to Call a Peer

- You need data or analysis from another domain (e.g., you're the product bot and need user feedback data from the user-research bot)
- A user asks you something outside your expertise — call the appropriate peer, then synthesize the response
- You want to verify or cross-reference information

### When NOT to Call a Peer

- The question is within your own domain
- The peer is likely to respond on their own in the group chat (redundant)
- Simple factual questions you can answer yourself

## Discovering Peers

Peer information is automatically injected by the gateway from fleet discovery. You can also check:

```bash
# List all running GolemBot instances
curl -s http://localhost:4000/api/fleet
```

## Conversation History Labels

In group chat history, messages are labeled:
- `[username]` — human message
- `[bot:BotName]` — message from a peer bot

Use these labels to understand the conversation context and avoid repeating what peers have already said.
