# Findog Independent Agent (Preview) — operations

The Findog Agent is a separate research agent for Findog administrators. It owns its
conversations, its own model/knowledge/web/MCP connections and its own durable run
pipeline. It does not read or write Fred's configuration, ledger, Telegram behaviour or
global model settings.

This document covers the operator-facing setup: environment, migration, worker, initial
state, credentials, cost semantics and the known V1 limits. Source and UI are in
English; the admin UI itself is German (`Findog Agent`, `Agent-Einstellungen`).

> Status: local implementation only. Nothing in this document has been applied to
> production. Migration, worker launch, key provisioning and deployment are separate,
> explicitly gated release steps.

## 1. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes (app + worker) | Supabase project URL (already used by the app). |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (app + worker) | Service-role client used by the admin routes and the worker. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes (app) | Existing browser session token issuance. |
| `FINDOG_AGENT_CREDENTIALS_KEY` | yes (app + worker) | Dedicated AES-256-GCM key for agent secrets: base64, exactly 32 bytes. Read only at runtime; never stored in the repository. |
| `FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS` | no | Comma-separated exact origins (`scheme://host[:port]`) the outbound transport may reach even though they are private or plain HTTP. Empty by default. |
| `FINDOG_AGENT_WORKER_PORT` | no | Worker health/readiness port, default `3002`. |
| `FINDOG_AGENT_WORKER_CONCURRENCY` | no | Parallel run slots, 1–4, default `1`. |
| `FINDOG_AGENT_WORKER_LEASE_SECONDS` | no | Run lease length in seconds, 15–3600, default `90`. |

The worker refuses to start if `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or
`FINDOG_AGENT_CREDENTIALS_KEY` is missing or if the key is malformed. Provision the key
with `openssl rand -base64 32`. Preserve an existing value when rotating other
configuration: changing `FINDOG_AGENT_CREDENTIALS_KEY` makes all previously stored
secrets undecryptable and requires every connection key to be re-entered.

## 2. Database migration

The agent uses its own `findog_agent_*` tables. The schema ships as a single migration:

```
supabase/migrations/20260910212000_findog_independent_agent.sql
```

The application never runs migrations automatically. Applying the SQL is a deliberate
operator step and is **not** part of this implementation:

```
# Local / staging only; the production step is separately gated.
supabase link --project-ref <project-ref>
supabase db push --include-all          # applies the migration above
```

Order: apply the migration **before** starting the worker and before the admin opens
`Agent-Einstellungen`. Until the tables exist, the settings route and the chat route
answer with a server error; the worker fails its first claim.

The migration is deny-by-default: every table has RLS enabled with no `anon` or
`authenticated` grants, and the lifecycle functions are granted to `service_role` only
with `search_path = ''`. Do not add broader grants.

## 3. Worker

The worker is a separate Node process and the only writer that turns a queued run into
research. An HTTP disconnect can never own generation.

```
npm run findog-agent:typecheck      # tsc -p tsconfig.findog-agent-worker.json
npm run findog-agent:build          # bundles dist/findog-agent-worker.mjs + syntax check
npm run findog-agent:worker         # node dist/findog-agent-worker.mjs
```

For local development `npm run findog-agent:worker:dev` rebuilds on change. The worker
exposes `GET /health` on `FINDOG_AGENT_WORKER_PORT` and reports
`{"status":"ready","databaseProbed":false}` — it deliberately does not claim the schema
or the configured connections were verified.

### Run semantics

- **Lease and fencing.** The worker claims queued runs with a random lease token and
  renews the lease at roughly a third of its length. Every external call is preceded by a
  fence that re-reads the run, re-checks current admin membership and verifies the
  locally observed lease deadline. A hung or failed heartbeat can never keep paid work
  running past the last verified lease expiry.
- **Reconnect.** Events are read with a monotonic per-run cursor. Reloading the admin chat
  or reconnecting only resumes reading from the stored cursor; it never enqueues a second
  run. Unmounting the chat stops polling only — it never calls Stop.
- **Stop.** `Stopp` terminalises a queued/running run, clears the fence and removes the
  partial assistant draft while keeping the user question. The final answer is written
  through a single atomic `finish` transaction, so a Stop that wins the race cannot leak a
  late answer.
- **Expired lease.** An expired running run is terminal (`failed`, code `lease_expired`).
  It is never silently retried against a paid provider; the operator must start a new run
  explicitly (`reap_findog_agent_runs`).
- **Shutdown.** `SIGTERM`/`SIGINT` abort active work, then the process exits within a
  bounded grace period. Known limitation: if a normal terminal write is already pending
  when the signal arrives, the process-level 30 s force-exit is the bound rather than a
  per-run graceful finalisation.

## 4. Initial state

The default configuration is **disabled** and empty: `enabled: false`, no connections, no
models, no knowledge base, web mode `off`, zero limits. The agent accepts no research
until an administrator stores a first settings revision in `Agent-Einstellungen`:

1. Add a connection (provider, base URL, API key) — e.g. DeepSeek, OpenRouter or an
   OpenAI-compatible `/v1` endpoint.
2. Add a model pointing at that connection, mark it active, then save.
3. Optionally configure the knowledge base, web search and MCP servers.
4. Only then enable the agent.

The chat screen reports missing prerequisites (no active model, missing key, knowledge
base without a selected KB, web search without an Exa key) before a question is sent.

## 5. Credentials

Secrets are encrypted with `FINDOG_AGENT_CREDENTIALS_KEY` and stored server-side only.
The admin API returns presence flags, never plaintext or ciphertext.

- Leaving a secret field empty keeps the stored value.
- Entering a value replaces it.
- `Wert entfernen` sends an explicit `null` that deletes it on save.
- A blank string is never sent; the server rejects blank secrets.

Settings are written as immutable revisions. A save sends `expectedRevision`; if another
administrator saved in the meantime the server answers `409` with code `conflict` and the
UI keeps the local edits and asks for a reload. Connection and model tests always run
against the last **saved** revision and are disabled until a first save exists.

## 6. Network policy

All outbound agent traffic goes through one transport that enforces the destination
policy: HTTPS only for public endpoints, no URL credentials, no cloud-metadata or
private/link-local destinations, same-origin redirects only and byte-bounded responses.
The only endpoints the agent may call are the ones an administrator configured (plus the
fixed Exa API). `FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS` is the single, server-side escape
hatch for private or plain-HTTP test origins and is never readable from request JSON,
model output or retrieved content.

## 7. Cost and usage

- Monetary limits are **estimates**, not invoice caps. The run aborts when the estimated
  cost exceeds the configured limit and the cost is measurable; when it is not
  measurable, the run fails closed rather than guessing.
- Model cost is reported or estimated when the provider returns usage; Exa cost is an
  estimate. WeKnora embedding/reranker cost and MCP cost are not observable and are
  shown as `nicht erfasst`/`uncovered`.
- Unknown usage or cost is rendered as `unbekannt` and never as `0`.

## 8. Limits and truncation

The UI states every bound it applies instead of presenting a truncated list as complete:
history is loaded up to 20 conversations (`hasMore` is reported), a conversation up to 50
messages, and run events in 200-event batches with a resumable cursor.

## 9. V1 scope and parity gaps

Text and research only:

- No attachments or vision; no file upload control is shown.
- No permanent cross-chat memory, no scheduled runs, no comparison UI and no agent-driven
  external writes.
- Multi-turn history is bounded and warns rather than silently dropping recent facts.

WeKnora is used for retrieval only (`knowledge-search`, scoped knowledge/chunk reads,
wiki search/read). There is no embed, no AgentQA and no session creation; per-request
reranker parameters are not invented. MCP supports Streamable HTTP with optional bearer
auth only — no stdio and no OAuth — and every tool must be explicitly allow-listed;
server-provided read-only annotations are hints, never authorization. Provider
compatibility was validated against fixtures and local mocks; one bounded live smoke per
provider remains a release prerequisite.

## 10. Verification in this repository

Backend and HTTP contracts are covered by the feature test suites and the embedded
PostgreSQL (PGlite) SQL tests. The admin UI is verified in a real browser against the
fixture harness — it renders the actual components and stylesheets, but only ever talks
to seeded synthetic API responses, so it proves rendering and interaction, not live
provider behaviour:

```
npx vitest run src/components/findog-agent src/lib/administration-ui.test.ts src/components/admin-workspace.test.ts
node tests/fixtures/findog-agent-ui/build.mjs
node tests/scripts/findog-agent-ui-browser.mjs   # screenshots land in the evidence directory
```

The harness lives under `tests/` and is not reachable from production routing. It adds no
auth bypass and reads no live credentials.

## 11. Release gates not executed here

Still outstanding and explicitly out of scope for this change:

1. Production migration (`supabase db push`).
2. Worker service launch and supervision.
3. Provisioning `FINDOG_AGENT_CREDENTIALS_KEY` and the connection keys.
4. Commit, push and deploy.
5. The full legal benchmark.

Existing services (Fred, Telegram, global model settings, the public site) remain
untouched.
