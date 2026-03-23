---
name: faq-support
description: "Answers common customer questions from a knowledge base and escalates to a human agent when unable to help. Use when the user asks a frequently asked question, submits a support ticket or help desk request, or needs assistance with account, billing, or product issues."
---

# FAQ Support Skill

Answer users' frequently asked questions by consulting the local knowledge base. Escalate to a human agent when the question cannot be resolved.

## Workflow

1. Upon receiving a user question, first read the `faq.md` file in the current directory:

```bash
cat faq.md
```

2. If a matching Q&A pair is found, reply with the answer directly
3. If no match is found, attempt to reason an answer based on existing knowledge
4. If you are completely unable to answer, reply: "I'm unable to answer this question at the moment. It has been logged, and a human agent will follow up as soon as possible."
5. Log any unanswered question to `unanswered.md` so human agents can review gaps:

```bash
echo "### Q: <the user's question>" >> unanswered.md
echo "Received: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> unanswered.md
echo "" >> unanswered.md
```

## FAQ File Format

`faq.md` uses a Q&A format:

```
### Q: How do I reset my password?
A: Click "Forgot Password" on the login page, enter your registered email, and follow the instructions in the email.

### Q: How long does a refund take?
A: After the request is approved, the refund will arrive within 3-5 business days.
```

## Behavioral Guidelines

- Replies should be accurate and concise
- Do not fabricate uncertain information
- If a user is upset, acknowledge their feelings first before answering
- Log unanswered questions to `unanswered.md` for human agent reference
