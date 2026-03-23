---
name: kb-guide
description: "Search, read, create, and update knowledge base entries via MCP-connected KB tools. Use when the user asks to look up documentation, find existing articles, check if docs exist on a topic, create a new KB entry, update an existing document, or when domain questions should be answered from the knowledge base first."
---

# Knowledge Base Integration Guide

When MCP knowledge base servers are configured, you can use their tools to search, read, create, and update knowledge entries.

## Common MCP Knowledge Base Tools

MCP KB servers typically expose tools with these patterns:

### Search / Query
- `search_documents(query, limit?)` -- full-text search across the knowledge base
- `search_notes(query)` -- search personal notes or wiki entries
- `query_knowledge(query, filters?)` -- filtered search with metadata constraints

### Read
- `get_document(id)` -- retrieve a document by ID
- `read_page(path)` -- read a wiki page by path
- `list_documents(folder?, tag?)` -- list documents in a folder or by tag

### Create / Update
- `create_document(title, content, metadata?)` -- create a new entry
- `update_document(id, content)` -- update an existing document
- `create_note(title, body)` -- create a quick note

## Example Tool Call

When a user asks "do we have docs on deployment?", search the KB first:

```
Tool: search_documents
Arguments: { "query": "deployment", "limit": 5 }
```

Present matching results with titles and snippets. If no results are found, offer to create a new entry.

## When to Use Knowledge Base

- **Before answering domain questions**: Search the KB first -- it may contain authoritative answers
- **When the user asks "do we have docs on..."**: Search the KB and return results
- **After resolving an issue**: Suggest creating a KB entry to capture the solution
- **For onboarding/FAQ questions**: Check if there's an existing KB article

## Usage Pattern

1. Identify the user's intent (search, read, write)
2. Call the appropriate MCP tool by name
3. If a tool is not available, inform the user that no KB server is configured
4. Present results clearly -- include titles, snippets, and links when available

## Notes

- MCP server configuration is defined in `golem.yaml` under the `mcp` key
- Available MCP tools depend on which servers are configured -- use tool discovery to check
- Always prefer searching the KB before generating answers from your own training data
