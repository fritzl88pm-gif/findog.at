# WeKnora REST Transport Migration Plan

> **For the implementing agent:** Work task-by-task in the order given. Every task
> ends with a green `npm run lint && npm run test` before the next one starts.
> Do not skip the "Done when" checks — several failure modes in this migration are
> **silent** (see "Silent failure traps"), so a passing build does not prove success.

**Goal:** Replace the WeKnora *secure embed channel* transport with the authenticated
WeKnora *REST API*, so that chat attachments uploaded on findog.at are staged into the
agent's sandbox at `/workspace/input` and the agent can read, process and rewrite real
files whose results come back through the existing artifact download cards.

**Why the embed channel cannot do this:** embed chat only accepts inline base64
`attachment_uploads`. WeKnora persists those without a storage URL
(`MessageAttachment.URL` is `json:"-"`), so the sandbox staging pass — which resolves
URLs from the `temporary_documents` table by attachment ID — silently skips them. Only
attachments uploaded via `POST /api/v1/sessions/{id}/attachments` and referenced as
`attachment_ids` reach the sandbox. That upload endpoint is not exposed on the embed
route group, and its handler requires strict session ownership, which an embed-owned
session never satisfies for an API-key caller.

**Architecture:** Keep every findog-side concern unchanged — request ledger, deadlines,
receipts, German research trace, Findok BFG citation verification, artifact cards,
Telegram worker. Swap only the transport layer beneath `TurnServiceUpstreamDeps`, add an
attachment pre-upload step, and mark each conversation with the transport that created
it so old embed conversations keep working untouched.

**Tech stack:** Next.js 16, React 19, TypeScript 6, Vitest, Supabase/PostgreSQL,
WeKnora REST API, Coolify.

---

## Verified facts

These were verified against the findog repo at `d8bd3f4` and the WeKnora source at
`Tencent/WeKnora@f260662`. Do not re-derive them; do verify the *deployment-specific*
values marked **[VERIFY]** against the live instance before writing code.

### WeKnora behaviour

- Embed chat is a thin wrapper: `delegateEmbedChat` patches the JSON body and calls the
  same `AgentQA` handler the REST route uses
  (`internal/handler/embed_channel.go:593-621`). **The SSE event format is identical on
  both transports** — no stream parsing changes are needed anywhere in findog.
- The embed payload patch force-clears `mcp_service_ids` and `knowledge_base_ids`, and
  drops `images` / `attachment_uploads` / `attachment_ids` when the channel disallows
  file upload (`internal/handler/embed_channel.go:698-712`).
- Sandbox staging runs at the start of every agent turn: it loads *all* attachments of
  the session from the DB and reconciles them into `/workspace/input/<sha256[:6]>/<name>`,
  then appends a `<sandbox_attachments root="/workspace/input">` manifest to the agent
  query (`internal/application/service/session_agent_qa.go:174-196`,
  `internal/application/service/session_attachment_staging.go:97-284`).
- Staging requires a storage URL, which is recoverable only through the attachment's
  temporary-document ID (`resolveSessionAttachmentURLs`). Attachments without an ID are
  dropped by `deduplicateSessionAttachments` **without error**.
- `/workspace/input` is read-only for the agent's write tools and is reconciled every
  turn — files written there by the agent are deleted again. Deliverables must go to
  `/workspace/output`.
- The artifact collector drains `/workspace/output` after every turn with no extension
  allowlist, caps a single file at 50 MiB, deduplicates by `(SourcePath, ModTime)`, and
  reports `FileType` as the lowercased file extension
  (`internal/application/service/artifact_collector.go:438-444`).
- Temporary-document upload is async. Status values: `uploaded`, `processing`, `ready`,
  `failed` (`internal/types/temporary_document.go:11-14`). The upload responds `202`.
  At send time WeKnora emits an `attachment_parsing` tool step, waits a bounded time,
  and skips unfinished attachments rather than failing the turn
  (`internal/handler/session/qa.go:1413-1510`).
- Per message: at most 5 attachments (`MaxTemporaryAttachmentsPerMessage`). Per file:
  `MAX_FILE_SIZE_MB` on the WeKnora deployment.
- OCR / VLM fallback for scanned or image-only PDFs exists **only** on the
  temporary-document path, driven by the agent config
  (`internal/handler/session/temporary_document.go:75-82`).
- API-key auth accepts the `X-API-Key` header (`internal/middleware/auth.go:161`).
- Per-user identity for API-key callers is configured per tenant via
  `APIPrincipalConfig.Mode` (`internal/middleware/auth.go:560-607`):
  - `direct`: header `X-External-User-ID`. Set `RequireDirectHeader` so a missing header
    fails closed instead of falling back to a shared tenant owner.
  - `signed_token`: header `X-External-User-Token`, an HS256 JWT with audience
    `weknora`, required `exp` (max lifetime 24 h), claim `tenant_id` matching the
    workspace, and `sub` = the external user id, max 128 chars
    (`internal/middleware/auth.go:611-686`).
  - Sessions are then owned by `api_external_user:<tenantID>:<sub>`
    (`internal/types/principal.go:32-40`), so isolation is enforced server-side.
- `GET /api/v1/agents/{id}` is reachable with the `chat` capability
  (`internal/router/routes_agent.go:28`) — no separate `read_agents` capability needed.
- All `/sessions` and `/agent-chat` routes require tenant role Viewer or higher plus the
  `chat` capability (`internal/router/routes_chat.go:51`, `:115-128`).
- Embed has Redis-backed rate limiting per IP, per day and per channel
  (`internal/middleware/embed_auth.go:24-72`). **The API path has none** — findog must
  provide its own.
- Embed pins every resource reference to `resource://` handle mode
  (`internal/handler/embed_channel.go:670-674`). On REST, `resource_urls=public` or a
  deployment default could return credential-free shareable URLs. **Never send
  `resource_urls=public`.**
- Sandbox image is `python:3.12-slim` with Node 20, `uv`, `pnpm`, `curl`, `jq`, `file`,
  zip/unzip (`docker/Dockerfile.sandbox`). `python-docx` and similar libraries are **not**
  preinstalled. Sandbox egress is open unless the tenant policy sets
  `DenyEgressByDefault` (`internal/types/sandbox_network_policy.go:23-27`).

### findog state

- Both entry points already route through `executeFredTurn` and the injectable
  `TurnServiceUpstreamDeps` interface (`src/lib/fred/turn-service.ts:46-130`):
  the web chat route (`src/app/api/fred/chat/route.ts:826`) and the Telegram worker
  (`src/lib/telegram/worker.ts:36-40`).
- **But** the web chat route only uses that seam for turns *without* attachments
  (`streamTextOnlyTurn`). The attachment path is a second, inline implementation in the
  same file that calls `openFredUpstreamStream` directly (around
  `src/app/api/fred/chat/route.ts:1120-1350`). This migration folds it into the seam.
- `TurnServiceUpstreamDeps` methods all carry embed-specific parameters
  (`channelId`, `publishToken`, `exchangeOrigin`, `sessionToken`, `sessionSignature`).
  These must be replaced by one opaque transport context object.
- findog already calls the REST API with `X-API-Key` for artifact downloads
  (`src/app/api/fred/conversations/[conversationId]/messages/[messageId]/artifacts/[artifactIndex]/route.ts:70`)
  and for native image artifacts (`src/app/api/fred/artifacts/[artifactId]/route.ts`).
  That works today because `loadSessionForRead` grants Admin+ callers read access to
  channel sessions (`internal/application/service/session.go:57-100`) — write paths
  deliberately do not get this.
- `fred_conversations.weknora_channel_id` is `not null`, constrained by
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`, part of the unique key
  `(weknora_channel_id, weknora_session_id)`, and a parameter of several SQL RPCs
  (`supabase/migrations/20260719012227_weknora_fred_chat_history.sql`).
- Deliverable extensions already include `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.csv`,
  `.md`, `.txt` (`src/lib/generated-artifact-types.ts`).
- Attachment mode is an admin setting, default `findog_preprocess`
  (`src/lib/scanning/settings.ts:27-28`).

### Deployment values to confirm first **[VERIFY]**

1. WeKnora tenant (workspace) numeric ID for the `tenant_id` JWT claim.
2. Fred agent ID and QuickFred agent ID on the REST API (`GET /api/v1/agents`).
3. That both agents have a **sandbox config assigned** and their tool allowlist contains
   `read_file`, `shell_exec`, `write_sandbox_file`, `edit_sandbox_file`. Without a
   sandbox config, staging is skipped silently.
4. `SupportedFileTypes` on both agents covers the extensions findog offers.
5. `MAX_FILE_SIZE_MB` and, if set, `WEKNORA_CHAT_ATTACHMENT_WAIT_TIMEOUT_SEC`.
6. Sandbox network policy — note whether egress is open (needed if the agent installs
   Python packages at runtime).

---

## WeKnora configuration prerequisites (no code, do this first)

An admin performs these in the WeKnora console. The code cannot compensate for any of
them.

1. Create a dedicated WeKnora user with tenant role **Viewer**, and issue an API key
   owned by that user with capability **`chat`** only. Do not reuse an admin key: an
   admin key additionally unlocks the channel-session read path described above.
2. Set the tenant's API principal mode to **`signed_token`** and configure its HMAC
   secret. (`direct` is acceptable for a first spike, but then set `RequireDirectHeader`.)
3. Confirm items 3 and 4 of **[VERIFY]** above on the Fred and QuickFred agents.
4. Keep the existing embed channels enabled and untouched until rollout completes — the
   migration runs both transports side by side.

---

## Environment variables

Add to `.env.example` and to Coolify as protected runtime variables. All are
server-only; none may carry a `NEXT_PUBLIC_` prefix.

```
WEKNORA_API_BASE_URL=https://taxdog.cloud
WEKNORA_API_KEY=                      # existing variable, now also used for chat
WEKNORA_API_TENANT_ID=                # numeric workspace id for the tenant_id claim
WEKNORA_API_EXTERNAL_USER_SECRET=     # HS256 secret for X-External-User-Token
WEKNORA_API_FRED_AGENT_ID=
WEKNORA_API_QUICKFRED_AGENT_ID=
WEKNORA_REST_TRANSPORT_ENABLED=false  # kill switch, see T11
```

`WEKNORA_FRED_*` and `WEKNORA_QUICKFRED_*` stay in place for the embed transport until
the rollout is finished.

---

## Architecture decisions

**D1 — Sentinel channel id instead of a schema change.** `weknora_channel_id` is
`not null`, regex-constrained and part of the unique key and several RPC signatures.
REST conversations store the constant `rest-fred` or `rest-quickfred` (both match the
regex). No migration of the history schema, no RPC signature changes. The transport flag
in D2 is what code branches on — never parse the channel id.

**D2 — Explicit transport column.** Add `fred_conversations.transport` as
`text not null default 'embed'` with `check (transport in ('embed','rest'))`. Every turn
reads the stored value and uses that transport; a conversation never switches. New
conversations use REST when the flag from T11 is on.

**D3 — One API key, per-user identity per request.** Never one key per user: keys are
tenant-level admin artifacts that carry their creator's role. findog mints a short-lived
HS256 JWT per upstream request (`sub` = Supabase user id, `tenant_id` claim, `aud`
`weknora`, `exp` now + 10 minutes) and sends it as `X-External-User-Token` alongside
`X-API-Key`. Neither the key nor the JWT ever reaches the browser.

**D4 — The attachment path moves into the seam.** Rather than porting the inline
attachment implementation in `chat/route.ts`, extend `executeFredTurn` to accept
attachments and delete the inline duplicate. This removes a long-standing divergence
between the web and Telegram paths and is why T6 is the largest task.

**D5 — Keep findog's preprocessing mode.** `findog_preprocess` (MinerU/Gemini) remains
untouched and remains the default. REST transport plus `weknora_native` attachments is
what unlocks the sandbox. The admin switch keeps its current semantics.

---

## Task breakdown

### T1 — REST client module

**New file:** `src/lib/weknora/rest-client.ts`
**New test:** `src/lib/weknora/rest-client.test.ts`

Implement a typed client. Base URL from `WEKNORA_API_BASE_URL`. Every request sends
`X-API-Key` and `X-External-User-Token`; never `resource_urls`.

| Function | Call |
|---|---|
| `createRestSession` | `POST /api/v1/sessions`, body `{}` → `{ success, data: { id } }` |
| `fetchRestAgentConfig` | `GET /api/v1/agents/{agentId}` |
| `uploadRestAttachment` | `POST /api/v1/sessions/{sid}/attachments`, multipart field `file`, plus form field `agent_id` → `202 { success, data: { id, status } }` |
| `getRestAttachment` | `GET /api/v1/sessions/{sid}/attachments/{aid}` → `{ data: { id, status } }` |
| `openRestAgentStream` | `POST /api/v1/agent-chat/{sid}`, SSE |
| `stopRestSession` | `POST /api/v1/sessions/{sid}/stop` — same body shape findog sends today |
| `loadRestMessages` | `GET /api/v1/messages/{sid}/load` |

`openRestAgentStream` body:

```jsonc
{
  "query": "...",
  "agent_enabled": true,
  "agent_id": "<env agent id>",
  "knowledge_base_ids": [],          // agent-configured; send [] unless T3 says otherwise
  "knowledge_ids": [],
  "web_search_enabled": false,
  "summary_model_id": "",            // Fred Pro model id when Pro is on
  "mcp_service_ids": [],
  "mentioned_items": [],
  "channel": "api",
  "attachment_ids": ["..."]          // omit the key entirely when empty
}
```

Reuse the existing hardening from `src/lib/weknora/fred-native.ts`: bounded JSON reading,
`UserVisibleError` with German messages, the same status mapping (429 → busy, 401/403 →
session expired, else → unreachable). Do not copy the HMAC signature helpers — REST has
no session signature.

**Done when:** unit tests cover header construction, the empty-`attachment_ids` omission,
each error status mapping, and that no request ever contains `resource_urls`.

---

### T2 — External user token minting

**New file:** `src/lib/weknora/external-user-token.ts`
**New test:** `src/lib/weknora/external-user-token.test.ts`

`mintExternalUserToken(userId: string): string` → HS256 JWT signed with
`WEKNORA_API_EXTERNAL_USER_SECRET`, claims: `sub` = userId, `tenant_id` = numeric
`WEKNORA_API_TENANT_ID`, `aud` = `"weknora"`, `iat`, `exp` = now + 10 min.

Throw a configuration error when the secret or tenant id is missing or non-numeric.
Reject a `sub` longer than 128 characters. Use `node:crypto`; do not add a JWT dependency
for one HS256 signature.

**Done when:** tests assert the claim set, the 10-minute expiry, rejection of an
oversized `sub`, and that the secret never appears in an error message.

---

### T3 — Capabilities from the agent config

**Files:** `src/app/api/fred/capabilities/route.ts`, `src/app/api/fred/capabilities/cache.ts`
(+ existing `route.test.ts`)

When REST transport is enabled, derive capabilities from `GET /api/v1/agents/{id}`
instead of the embed channel config: web search, image upload, and the agent's
`SupportedFileTypes`. Keep the existing response shape, and keep the cache behaviour.
Expose the supported extensions so the composer can gate uploads instead of relying on
findog's hardcoded list.

**Done when:** the capabilities response is byte-identical in shape between transports,
and a missing/unreachable agent degrades exactly like a missing channel does today.

---

### T4 — Transport context in the upstream interface

**Files:** `src/lib/fred/turn-service.ts`, `src/lib/fred/turn-types.ts`

Replace the embed-specific parameters on every `TurnServiceUpstreamDeps` method with a
single opaque `transport` object the adapter owns:

```ts
export type FredTransportContext =
  | { kind: "embed"; channelId: string; publishToken: string; exchangeOrigin: string;
      sessionToken: string; sessionId: string; sessionSignature: string }
  | { kind: "rest"; agentId: string; userId: string; sessionId: string };
```

This is a mechanical refactor: signatures change, turn logic does not. `relayEvent` becomes
optional (REST has no channel webhook) — `executeFredTurn` must treat a missing
`relayEvent` as a no-op, not an error.

**Done when:** `npm run test` is green with the embed adapter only, i.e. behaviour is
provably unchanged before any REST code is wired in.

---

### T5 — Two adapters behind the interface

**New file:** `src/lib/weknora/transport-rest.ts`
**New file:** `src/lib/weknora/transport-embed.ts` (move the existing wiring here)
**New test:** `src/lib/weknora/transport-rest.test.ts`

Each exports a `TurnServiceUpstreamDeps` implementation. A `resolveFredTransport(...)`
factory picks one from the conversation's stored transport (T7), falling back to the
flag (T11) for new conversations. The REST adapter's `mintSession` is a no-op returning
an empty token; its `visitorId` returns the findog user id.

**Done when:** both adapters satisfy the same interface and the existing turn-service
tests pass against each of them via a shared contract test.

---

### T6 — Attachment upload path (largest task)

**Files:** `src/app/api/fred/chat/route.ts`, `src/lib/fred/turn-service.ts`,
`src/lib/telegram/worker.ts` (+ tests)

1. Extend `executeFredTurn` to accept validated attachments.
2. Move the inline attachment implementation out of `chat/route.ts` into the turn
   service, so both transports and both entry points share one code path. Delete the
   duplicate.
3. On the REST transport with `weknora_native` mode: upload each attachment via
   `uploadRestAttachment` **before** opening the stream, collect the returned ids, and
   send them as `attachment_ids`. Do not send `attachment_uploads` on REST at all.
4. Keep `images` inline as today — the VLM path is unchanged.
5. Emit the existing "Dokumente werden analysiert …" status during upload, and clear it
   when the stream opens.
6. Enforce findog-side limits before uploading: at most 5 documents, per-file size within
   the WeKnora limit. Fail fast with the existing German error wording.
7. Keep `findog_preprocess` behaviour exactly as it is.

**Done when:** a REST turn with two documents performs two uploads, sends both ids, sends
no `attachment_uploads`, and the Telegram worker exercises the same code path in its
tests.

---

### T7 — Conversation transport column

**New migration:** `supabase/migrations/20260916xxxxxx_fred_conversation_transport.sql`
**Files:** conversation read/write paths in `src/app/api/fred/conversations/*` and
`src/lib/weknora/fred-history.ts`

```sql
alter table fred_conversations
  add column transport text not null default 'embed'
  check (transport in ('embed', 'rest'));
```

Store `rest` for conversations created on the new transport, together with the sentinel
channel id from D1. Every subsequent turn of a conversation reads this column and uses
that transport; a mismatch between stored transport and current flag must never silently
switch — existing conversations keep their transport forever.

**Done when:** an embed conversation still resolves the embed adapter with the flag on,
and a REST conversation still resolves REST with the flag off.

---

### T8 — Attachment parsing trace step

**Files:** `src/lib/fred/execution-trace.ts` (+ test)

WeKnora emits a tool step named `attachment_parsing` with
`data.display_type = "attachment_parsing"`, `parsed_count` and `skipped_count`. The
generic fallback in `resolveToolConfig` (`:299`) already renders it, but with an English
tool name. Add an explicit mapping with German labels, e.g. running
`Anhänge werden gelesen …` and completed `N Anhänge gelesen` — and surface
`skipped_count > 0` visibly, because a skipped attachment means the agent answered
*without* that document.

**Done when:** a stream fixture containing the step renders the German label and a
non-zero skip count is visible in the trace.

---

### T9 — Rate limiting

**New file:** `src/lib/fred/rest-rate-limit.ts` (+ test)

The API transport has no upstream rate limiting. Add a per-user and a global limiter in
front of upstream calls, reusing the existing admission-control style from
`src/lib/attachments/heavy-request-admission.ts` and the request ledger. Suggested
starting values, tunable by env: 20 turns per user per hour, 10 concurrent upstream
streams process-wide. Exceeding a limit returns the existing "Fred ist derzeit
ausgelastet" error, not a crash.

**Done when:** tests cover per-user and global rejection, and that the limiter releases
its slot on stream abort, error and normal completion alike.

---

### T10 — Webhook retirement and audit replacement

**Files:** `src/app/api/webhooks/weknora/route.ts` (+ test), new reconciliation helper

The channel webhook exists only on the embed transport. Keep the route working for embed
conversations during rollout. For REST conversations add a reconciliation path that
compares findog's persisted messages against `GET /api/v1/messages/{sid}/load`, so the
independent audit trail described in the README is not simply lost. Run it on demand
(admin action) rather than on a timer for the first iteration.

**Done when:** the webhook route rejects nothing it accepts today, and the reconciliation
helper reports drift for a seeded mismatch.

---

### T11 — Feature flag and rollout switch

**Files:** `src/lib/config.ts`, capabilities route, conversation creation

`WEKNORA_REST_TRANSPORT_ENABLED` gates only *new* conversation creation. Existing
conversations follow their stored transport (T7). The flag must be readable server-side
only and must never appear in a capabilities response sent to the browser.

**Done when:** flipping the flag off stops new REST conversations without affecting
running or stored ones.

---

### T12 — Documentation

**Files:** `README.md`, `.env.example`, this plan's status section

Document the new variables, the two transports, the WeKnora prerequisites, and the fact
that sandbox file exchange requires REST plus `weknora_native`. Update the attachment
section of the README, which currently states that files are forwarded "for the current
request only" — on REST they persist for the session lifetime as temporary documents.

---

## Silent failure traps

Each of these produces a *working-looking* system that quietly does the wrong thing.
Add an explicit check or test for every one.

1. **No sandbox config on the agent** → staging is skipped, files never appear in
   `/workspace/input`, the agent answers from the prompt text and nobody notices.
   Verify with a live turn that asks the agent to `ls /workspace/input`.
2. **`direct` mode without `RequireDirectHeader`** → a dropped header silently maps every
   findog user onto one shared session owner.
3. **`resource_urls=public`** → credential-free shareable URLs for client documents.
   Assert in tests that the parameter is never sent.
4. **An admin-owned API key** → unlocks the Admin+ channel-session read path. Use a
   Viewer-role key.
5. **`attachment_uploads` sent on REST** → WeKnora accepts them, the answer looks fine,
   but those files never reach the sandbox. Assert they are absent from REST bodies.
6. **Skipped attachments** (`skipped_count > 0`) → the agent answered without a document
   the user uploaded. Must be visible in the UI (T8).
7. **Agent rebuilds instead of edits** → for a `.docx` round trip the agent has the
   extracted text in its prompt and may regenerate the document from scratch, destroying
   all formatting. This is an agent-prompt concern, not a findog one, but it is the most
   likely user-visible disappointment. Note it for the agent configuration work that
   follows this migration.

---

## Verification before rollout

Run these against a staging conversation with the flag on:

1. Text-only turn → answer, trace and citations identical to the embed transport.
2. Turn with one PDF → `attachment_parsing` step appears, answer references the content.
3. Ask the agent to list `/workspace/input` → the uploaded file is there with its real
   name and size.
4. Ask the agent to write a file to `/workspace/output` → download card appears in findog
   and the downloaded bytes match.
5. Upload a `.docx`, ask for a name replacement → downloaded file opens in Word with
   formatting intact. Check headers, footers and footnotes for missed occurrences.
6. Second turn in the same conversation → the first turn's file is still staged.
7. Abort a running turn → upstream stop fires, the rate limiter slot is released.
8. Old embed conversation → still works, still uses embed.

---

## Out of scope

- Patching or forking WeKnora. Nothing in this plan requires a WeKnora code change.
- `continue-stream` and `steer`, which the REST API offers and embed does not. Worth a
  follow-up plan; not part of this migration.
- The `docx-redact` skill for reliable Word editing. Recommended as the production answer
  to trap 7, but it is WeKnora-side work and belongs in its own plan.
- Removing the embed transport. It stays until REST has run in production long enough to
  trust it.
