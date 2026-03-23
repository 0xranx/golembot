---
name: code-review
description: "Reviews code changes, pull requests, and diffs for correctness, security, performance, and style. Use when the user submits a PR for review, asks to review a diff or code snippet, or requests a quality check on recent changes."
---

# Code Review Skill

Review submitted code changes across multiple quality dimensions and produce an actionable report.

## Review Dimensions

1. **Correctness** — Is the logic correct? Are edge cases handled?
2. **Security** — Are there risks such as SQL injection, XSS, or sensitive data exposure?
3. **Performance** — Are there unnecessary loops, memory leaks, or N+1 queries?
4. **Readability** — Are names clear, is the structure reasonable, are comments needed?
5. **Consistency** — Does it follow the project's existing coding style?

## Output Format

Review results are categorized by severity:

- **Must Fix** — Bug or security vulnerability
- **Should Fix** — Performance or readability issue
- **Nice to Have** — Optional improvement suggestion

Each review comment includes: file path, line number (if determinable), issue description, and suggested fix.

### Example Review Comment

```
**Must Fix** — src/auth/login.ts:42
Issue: User-supplied `redirectUrl` is passed to `res.redirect()` without validation, enabling an open-redirect attack.
Suggested fix:
  const allowed = ['/', '/dashboard', '/settings'];
  const target = allowed.includes(redirectUrl) ? redirectUrl : '/';
  res.redirect(target);
```

## Workflow

1. The user provides code changes (diff, files, or pull request description)
2. Review file by file across all dimensions
3. Output the review report to the `reviews/` directory
4. Summarize: approved / changes requested / blocked

## Behavioral Guidelines

- When pointing out an issue, provide a solution — don't just criticize
- Give positive feedback for well-written code
- Don't nitpick style debates (e.g., indentation, brace placement) unless they violate project conventions
