---
name: azure-dab
description: Provision free Azure SQL databases and manage Data API Builder (REST/GraphQL/MCP) endpoints. Use when the user wants to create a database, expose tables as APIs, or query data through DAB.
metadata: {"openclaw":{"emoji":"🗄️"}}
---

# Azure Data API Builder

You have four tools for working with Azure SQL + Data API Builder.

## IMPORTANT: First-time users

**Always start with `azure_sql_provision action=setup`** when the user hasn't used this plugin before or says anything like "set up a database", "get started", "I want a SQL database", etc.

The `setup` action detects what the user is missing (Azure CLI, Azure account, .NET, DAB CLI, login state) and gives OS-specific install instructions. It's safe to call anytime — it's read-only.

Do NOT skip straight to `action=create` — the user may not have prerequisites installed.

## Tools

### `azure_sql_provision` — Create a free Azure SQL database
Use this when the user wants a new database. The free offer gives 100K vCore seconds + 32GB storage/month (up to 10 DBs per subscription).

**Recommended flow for new users:**
1. `action=setup` — guided check of ALL prerequisites (Azure CLI, Azure account, .NET, DAB)
2. Wait for user to install anything missing
3. `action=setup` again to confirm everything's ready
4. `action=login` — if not logged in
5. `action=create` — provision the database
6. Move to dab_manage for API setup

**Recommended flow for returning users:**
1. `action=check` — quick prerequisite verification
2. `action=create` — provision another database
3. `action=status` — show existing free databases

**Security defaults** (do not weaken these):
- TLS 1.2 enforced
- Firewall: current IP only (no 0.0.0.0/0)
- 32-char cryptographically random admin password
- Auto-pause when free limits exhausted (no surprise bills)
- Connection string stored in secret store, never in config files

### `dab_manage` — Configure and run Data API Builder
Use this after provisioning a database or when the user wants to expose tables as APIs.

**Recommended flow:**
1. `action=install-dab` — install DAB CLI if not present
2. `action=init` — create dab-config.json with secure defaults
3. `action=add-entity` — expose tables/views one at a time
4. `action=validate` — check config for security issues
5. `action=start` — run DAB

**Security rules:**
- Connection strings MUST use `@env('SQL_CONN')` — never embed plaintext
- Default auth: EntraID for production, Simulator only for local dev
- Session context enabled by default (JWT claims → SQL SESSION_CONTEXT for row-level security)
- CORS locked to localhost by default
- Always validate config before starting in production

**Permission best practices:**
- Start with `anonymous: [read]` only for public data
- Use `authenticated` role for logged-in users
- Never grant `*` (all actions) to `anonymous`
- Define custom roles for fine-grained access

### `dab_query` — Query a running DAB instance
Use this to read/write data through DAB's REST or GraphQL endpoints.

**REST examples:**
- List all: `method=rest, entity=products, restMethod=GET`
- Filter: `method=rest, entity=products, filter="price gt 10", orderby="name asc", top=10`
- Create: `method=rest, entity=products, restMethod=POST, body={name: "Widget", price: 9.99}`
- Update: `method=rest, entity=products, restMethod=PATCH, id="1", body={price: 12.99}`

**GraphQL examples:**
- Query: `method=graphql, query="{ products { items { id name price } } }"`
- With filter: `method=graphql, query="{ products(filter: {price: {gt: 10}}) { items { id name } } }"`

### `dab_mcp` — MCP endpoint bridge (DAB 1.7+)
DAB natively supports Model Context Protocol. Use this to check if MCP is available and get connection info.

- `action=status` — check if MCP is enabled and DAB is running
- `action=list-tools` — show available MCP tools (inferred from DAB entities)
- `action=call-tool` — get connection info for MCP clients (DAB uses SSE transport)

## Quick Start Script

If the user says "set up a database" or similar, walk them through:

```
1. azure_sql_provision action=setup          ← ALWAYS start here for new users
2. (user installs any missing prerequisites)
3. azure_sql_provision action=setup          ← re-check
4. azure_sql_provision action=login          ← if not logged in
5. azure_sql_provision action=create         ← provision the free database
6. dab_manage action=install-dab             ← if DAB CLI not installed
7. dab_manage action=init                    ← create DAB config with secure defaults
8. dab_manage action=add-entity entityName=<table> sourceObject=<table> permissions=[{role:"anonymous",actions:["read"]}]
9. dab_manage action=validate                ← check config for security issues
10. dab_manage action=start                  ← start DAB server
```

From absolute zero (no Azure account): ~10 minutes.
With prerequisites already installed: ~3 minutes.
