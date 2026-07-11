# OpenAI-Compatible BYOK LLM Integration Plan

> **For Hermes:** Execute this plan with `subagent-driven-development` task-by-task. Use Codex CLI for implementation and an independent model for every review.

**Goal:** Let authenticated Findog users create, test, edit, delete, and select their own OpenAI-compatible API connections and models for the Findog chat/agent runtime without exposing, logging, or storing plaintext API keys.

**Architecture:** Each user-owned connection stores one encrypted API key and one public HTTPS base URL in Supabase. The browser receives only safe metadata, masked key suffixes, and model metadata. The server authenticates every request, resolves the selected model to its owner, decrypts the key only inside the provider call, and passes a normalized `LlmRuntime` into the existing chat-title and agent loop. Every BYOK request uses the OpenAI Chat Completions tool-call protocol.

**Tech Stack:** Next.js 16/Node.js runtime, TypeScript, Supabase service-role server client, Node `crypto` AES-256-GCM, OpenAI-compatible HTTP APIs, Vitest.

---

## Scope and product rules

### One integration type only

The settings UI has exactly one connection type: **OpenAI compatible**.

| Setting | Value |
|---|---|
| Base URL | user-supplied public HTTPS API base URL, normally ending in `/v1` |
| Authentication | `Authorization: Bearer <API key>` |
| Inference endpoint | `POST /chat/completions` |
| Optional catalog endpoint | `GET /models` |
| Agent capability | OpenAI-style Function Calling |

There is no dedicated OpenAI integration, no Anthropic adapter, no OpenRouter integration, no provider selector, no custom headers, and no OAuth flow. The app treats every configured endpoint as an opaque OpenAI-compatible endpoint. This is protocol-based, not vendor-based: no provider receives special code or UI treatment.

The existing platform-owned DeepSeek Flash/Pro models remain available and continue using only the server-side DeepSeek key.

### Model capability rules

- A connection test checks authentication and tries the standard `GET /models` endpoint.
- The catalog is optional because compatible providers may not expose it. Users can enter a model ID manually.
- Every saved model has two explicit probes:
  - **Chat test:** a minimal deterministic completion proves that the exact model ID is accessible.
  - **Agent test:** a forced no-op function call proves that the model returns valid structured tool calls.
- Only models that pass the Agent test appear in the Findog composer. This prevents selecting a chat-only model that cannot operate the existing Findok/MCP tool loop.
- A model that only passes the Chat test stays visible in settings as `Chat only` but cannot replace the agent model.

### Attachment boundary

This feature changes the selected **chat/agent model**, not the existing PDF/image extraction service. Attachment preprocessing is an independent existing server-owned OpenRouter workflow and remains unchanged.

Do not silently send a user-selected key to the attachment extractor, and do not claim that arbitrary compatible endpoints support PDF/image ingestion. Provider-owned document processing is a separate project requiring explicit vision/PDF capability tests.

---

## Security design

### Key hierarchy and encrypted storage

1. Add server-only Coolify secret `FINDOG_BYOK_KEYRING` containing a JSON object of versioned 32-byte base64 keys, for example `{"v1":"<base64-32-byte-key>"}`.
2. Add `FINDOG_BYOK_ACTIVE_KEY_VERSION=v1`.
3. Parse and validate both environment values only in `src/lib/llm/credentials.ts`; reject use if the active key is missing or does not decode to exactly 32 bytes.
4. Encrypt API keys with Node `crypto` AES-256-GCM using a random 96-bit IV.
5. Bind ciphertext to its owner and connection with AAD exactly shaped as `findog-byok:<keyVersion>:<userId>:<connectionId>`.
6. Persist only base64url `ciphertext`, `iv`, `auth_tag`, `key_version`, and a non-sensitive last-four-character suffix. Never persist plaintext keys, browser-encrypted keys, or full key values in any response.
7. Re-encrypt a row after successful decrypt if it uses an old active-key version. Retain old key versions in the deployed keyring until all rows are rotated.
8. Deleting a connection performs a hard delete and cascades to stored model rows. There is no retained key archive.

### Server boundaries

- Every connection, model, test, and chat route calls `authenticateSupabaseRequest` before database or endpoint work.
- All Supabase reads select explicit safe columns. API responses never contain key ciphertext, IV, tag, key version, raw endpoint bodies, raw headers, or plaintext keys.
- Browser settings contain only a model reference (`platform:<model>` or `user:<UUID>`), never a connection secret.
- Endpoint failures map to safe codes only: `invalid_credentials`, `invalid_endpoint`, `rate_limited`, `model_unavailable`, `tool_calls_unsupported`, `timeout`, `endpoint_unavailable`.
- Model selection is resolved on the server using the authenticated user ID. A foreign UUID returns `403`; it never falls back to the shared DeepSeek key.
- Raw upstream errors must neither be returned nor logged, because compatible endpoints may echo submitted credentials or request material.

### SSRF protection

A user-provided compatible base URL is a network egress feature. Do not ship it without all of these controls:

- Parse and canonicalize the URL; require `https:`, no URL credentials, no query/fragment, and a non-empty hostname.
- Reject localhost, single-label hostnames, every IPv4/IPv6 literal, and all private, loopback, link-local, multicast, carrier-grade NAT, documentation, and reserved ranges.
- Resolve the hostname immediately before each request; reject it when **any** resolved address is not public.
- Use an outbound dispatcher that validates the lookup used for the actual connection; a standalone preflight DNS lookup does not prevent DNS rebinding.
- Do not follow redirects for user-supplied endpoints. Any redirect is a validation error.
- Enforce endpoint timeouts and bounded upstream response-body reads.
- Apply a production network-egress rule blocking private/internal ranges and metadata endpoints as defense in depth.

### Limits and payload bounds

- Move chat rate-limit identity from unauthenticated IP-only state to authenticated user ID after auth; keep the existing IP limit as a coarse outer guard.
- Add atomic database rate limits: 10 draft/stored connection tests and 10 model probes per user per 15 minutes.
- Validate input sizes: label 1–80 chars, model ID 1–200, display name 1–120, base URL 1–2,048, API key 16–1,024, max 10 connections and 50 models per user.
- Replace the existing multipart `Content-Length`-only check with bounded streaming before `formData()` so a missing or false header cannot cause unbounded document/model work.
- Add baseline production security headers in `next.config.ts`: CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`, and HSTS on HTTPS production traffic.

---

## Data model

Create `supabase/migrations/0004_user_llm_connections.sql`.

### `user_llm_connections`

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `label varchar(80) not null`
- `base_url text not null`
- `key_ciphertext text not null`
- `key_iv text not null`
- `key_auth_tag text not null`
- `key_version varchar(32) not null`
- `key_suffix varchar(8) not null`
- `last_test_status text null`
- `last_tested_at timestamptz null`
- `last_test_error_code text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `user_llm_models`

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `connection_id uuid not null references public.user_llm_connections(id) on delete cascade`
- `provider_model_id varchar(200) not null`
- `display_name varchar(120) not null`
- `chat_ready boolean not null default false`
- `agent_ready boolean not null default false`
- `last_tested_at timestamptz null`
- `last_test_error_code text null`
- `enabled boolean not null default true`
- timestamps
- unique `(connection_id, provider_model_id)`

Enable RLS, revoke all access from `anon` and `authenticated`, and grant only `service_role` access. Add ownership indexes on `(user_id, updated_at desc)` and `(user_id, enabled)`. Add a small service-role-only atomic rate-limit primitive. No key material belongs in agent-run rows, audit tables, traces, or rate-limit records.

---

## LLM abstraction

Create a minimal runtime model. Do not extend `ChatModel` with arbitrary user strings.

```ts
export type SelectedModelRef =
  | { kind: "platform"; model: "deepseek-v4-flash" | "deepseek-v4-pro" }
  | { kind: "user"; modelId: string };

export type LlmRuntime = {
  kind: "platform_deepseek" | "openai_compatible";
  modelId: string;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  agentReady: boolean;
};
```

Create these modules:

- `src/lib/llm/types.ts` — normalized messages, tools, calls, runtime, safe connection/model DTOs.
- `src/lib/llm/credentials.ts` — keyring parsing, AES-GCM encryption/decryption/rewrap, masking, no logs.
- `src/lib/llm/validation.ts` — strict bodies, URL/model/key validation.
- `src/lib/llm/ssrf.ts` — public HTTPS validation and safe outbound HTTP setup.
- `src/lib/llm/openai-compatible.ts` — Chat Completions adapter for a selected runtime.
- `src/lib/llm/connections.ts` — safe database queries, ownership enforcement, decrypt-at-use resolution.
- `src/lib/llm/catalog.ts` — optional `/models`, exact model probes, connection test results.

The adapter uses normalized OpenAI-style `messages`, `tools`, assistant `tool_calls`, and tool messages with `tool_call_id`. Provider calls remain non-streaming internally; Findog keeps its existing server-to-browser NDJSON stream and agent-step events.

Refactor `src/lib/deepseek.ts` into a platform-only runtime wrapper around this protocol where that reduces duplication, but do not make the platform key configurable through the BYOK UI.

---

## HTTP API

Every route is Node runtime, authenticated, strict-schema validated, rate-limited, and returns safe DTOs only.

| Route | Methods | Responsibility |
|---|---|---|
| `src/app/api/llm-connections/route.ts` | `GET`, `POST` | list safe connection summaries; create only after server-side connection validation |
| `src/app/api/llm-connections/test/route.ts` | `POST` | test an unsaved URL/key draft without persistence |
| `src/app/api/llm-connections/[connectionId]/route.ts` | `PATCH`, `DELETE` | edit label/base URL/key; hard-delete models via cascade |
| `src/app/api/llm-connections/[connectionId]/test/route.ts` | `POST` | test a stored, server-decrypted connection |
| `src/app/api/llm-connections/[connectionId]/catalog/route.ts` | `GET` | attempt a bounded safe `/models` catalog lookup |
| `src/app/api/llm-models/route.ts` | `GET`, `POST` | list owned selectable models; save manually entered or catalog-selected models |
| `src/app/api/llm-models/[modelId]/route.ts` | `PATCH`, `DELETE` | update display/enabled state; hard-delete model |
| `src/app/api/llm-models/[modelId]/test/route.ts` | `POST` | run chat and forced function-call probes with a decrypted server key |

Update `src/app/api/chat/route.ts` so it accepts one strict `modelSelection` reference, never a raw URL/key/model-provider payload. Resolve it after auth and pass `LlmRuntime` to `runAgent` and `generateConversationTitle`. A deleted, disabled, chat-only, or foreign model produces an explicit safe error and resets the client to platform DeepSeek Pro.

---

## UI design

Modify the existing Settings **Model** tab and rename it to **Models & API**.

1. Keep compact platform DeepSeek Flash/Pro choices in `Findog standard models`.
2. Add `Your compatible APIs` with safe cards: label, URL hostname only, masked key suffix, last test state, and model count.
3. `Add compatible API` opens one focused dialog with label, base URL, password API-key field, `Test connection`, and `Save API`.
4. Do not render a provider selector or provider-specific controls.
5. Connection detail offers a bounded searchable optional catalog and a manual model-ID input.
6. Each saved model shows capability state plus `Test model`, `Edit name`, `Disable/enable`, and `Delete`.
7. Each connection supports `Edit` and destructive `Delete`; deletion text explicitly says all associated models are deleted.
8. The existing composer model popover adds `Your agent models`, containing only enabled, agent-ready owned models.
9. Persist only `SelectedModelRef` in local settings. Never add API keys, URLs, or connection ciphertext to local storage, debug views, or chat payloads.
10. Preserve current keyboard navigation, focus behavior, mobile layout, and Findog visual style.

---

## Implementation tasks

### Task 1: Add model selection and runtime types

**Files:**
- Create: `src/lib/llm/types.ts`, `src/lib/llm/types.test.ts`
- Modify: `src/lib/config.ts`, `src/lib/chat/settings.ts`, `src/lib/chat/settings.test.ts`

1. Write failing tests for platform/user selection parsing, invalid UUIDs, and legacy DeepSeek setting migration.
2. Add `SelectedModelRef` and `LlmRuntime`; retain platform defaults.
3. Run focused tests, then `npm test`.
4. Commit: `refactor(llm): add model selection types`.

### Task 2: Add encrypted storage and safe ownership repository

**Files:**
- Create: `src/lib/llm/credentials.ts`, `src/lib/llm/credentials.test.ts`, `src/lib/llm/connections.ts`, `src/lib/llm/connections.test.ts`, `supabase/migrations/0004_user_llm_connections.sql`
- Modify: `.env.example`, `README.md`

1. Write failing crypto tests: AES-GCM round-trip, unique IVs, wrong AAD, tampering, invalid keyring, masking, and rewrap.
2. Write failing repository tests for safe DTOs, owner scoping, foreign access rejection, and hard delete.
3. Implement keyring parsing, encrypted fields, DB schema/RLS/grants/indexes, and explicit safe selects.
4. Apply the migration only after a reviewed backup/checkpoint plan; verify tables, RLS, permissions, and empty-row counts.
5. Commit: `feat(byok): store encrypted compatible API credentials`.

### Task 3: Implement SSRF-safe compatible endpoint access

**Files:**
- Create: `src/lib/llm/ssrf.ts`, `src/lib/llm/ssrf.test.ts`
- Modify: `package.json` only if a vetted dispatcher package is required

1. Write failing tests for malformed URLs, HTTP, URL credentials, localhost, private/reserved IPv4 and IPv6, DNS rebinding guard, redirect rejection, and public HTTPS acceptance.
2. Implement the validated no-redirect outbound request path with connection-time DNS validation, timeout, and response-size cap.
3. Add the production Coolify egress validation checklist.
4. Commit: `feat(byok): protect compatible API endpoints`.

### Task 4: Implement the OpenAI-compatible protocol adapter

**Files:**
- Create: `src/lib/llm/openai-compatible.ts`, `src/lib/llm/openai-compatible.test.ts`, `src/lib/llm/catalog.ts`, `src/lib/llm/catalog.test.ts`
- Modify: `src/lib/mcp/tools.ts`, `src/lib/deepseek.ts` if deduplication is safe

1. Write failing tests for endpoint paths, Bearer header, chat payload, multiple tool calls, tool-result continuation, malformed response, timeouts, normalized errors, optional `/models`, and manual model fallback.
2. Implement `POST /chat/completions` and optional `GET /models`.
3. Add a deterministic chat probe and a forced no-op Function Calling probe; neither invokes MCP nor a side effect.
4. Keep provider calls non-streaming internally.
5. Commit: `feat(llm): support compatible chat and tool calls`.

### Task 5: Add authenticated BYOK API routes

**Files:**
- Create: every route in the HTTP API table plus focused `*.test.ts` files

1. Write route tests for missing auth, foreign ownership, invalid inputs, safe outputs, no persistence on failed draft test, update without key replacement, hard delete, and rate limits.
2. Implement routes over the connection/catalog services.
3. Ensure every failure response is a safe error code/message, never raw endpoint output.
4. Commit: `feat(api): manage compatible LLM connections`.

### Task 6: Refactor chat, title, and agent loop to use `LlmRuntime`

**Files:**
- Modify: `src/lib/agent.ts`, `src/lib/conversation-title.ts`, `src/app/api/chat/route.ts`, `src/lib/deepseek.ts`
- Modify: `src/app/api/chat/route.test.ts`, `src/lib/agent.test.ts`, `src/lib/conversation-title.test.ts`

1. Write failing tests proving platform models use only the platform key and user models resolve only their owner’s decrypted runtime.
2. Refactor agent/title calls to use the compatible adapter and normalized runtime.
3. Preserve chat persistence, the existing NDJSON stream, MCP/BFG behavior, and safe persisted model labels.
4. Test deleted, disabled, chat-only, foreign, and nonexistent selections.
5. Commit: `refactor(chat): resolve compatible LLMs server-side`.

### Task 7: Implement the Models & API UX

**Files:**
- Modify: `src/app/page.tsx`, `src/app/globals.css`
- Create: focused UI/source tests compatible with the existing Vitest setup

1. Write failing tests for the single compatible-API form, secret-free local storage/payloads, safe masked rendering, test/capability status, deletion, and model fallback.
2. Replace static model settings with the connection/model management flow.
3. Extend the composer popover with enabled agent-ready user models.
4. Verify focus trap, Escape, outside click, mobile layout, and no provider-selector UI remains.
5. Commit: `feat(ui): manage compatible API models`.

### Task 8: Final hardening, review, and release

**Files:**
- Create/modify: `next.config.ts`, `README.md`, `.env.example`, header/security tests, optional operations runbook

1. Write failing tests for headers and the absence of BYOK secrets from client-facing code/build output.
2. Add security headers, multipart stream cap, auth-based limits, and operational docs.
3. Run `git diff --check`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
4. Use an independent review agent for spec compliance and a different one for security/SSRF/crypto/ownership review. Fix Critical/High findings, then rerun checks.
5. Add encryption keys directly to Coolify sensitive configuration without printing them; deploy only after migration checkpoint approval.
6. Live-smoke with a dedicated test account and disposable key: create → test → add model → agent tool call → edit → hard-delete. Verify browser and APIs never return the full key.

---

## Reference and acceptance criteria

The selected protocol is based on the [OpenAI Chat Completions Function Calling format](https://developers.openai.com/api/docs/guides/function-calling). A compatible endpoint is accepted only after Findog’s actual chat and agent probes succeed.

- [ ] Users can create, test, edit, delete, and select OpenAI-compatible API connections and models.
- [ ] No browser, local storage entry, chat payload, log, agent trace, database API response, source, or Git commit contains a user plaintext key.
- [ ] Users can only access their own connections/models, cryptographically and through server ownership checks.
- [ ] Agent-ready models complete correct Chat Completions tool-call continuation against Findog MCP tools.
- [ ] User selections never fall back silently to the shared DeepSeek key.
- [ ] Compatible endpoints cannot reach private/internal Docker/Supabase/VPS/metadata networks.
- [ ] DeepSeek Flash/Pro and existing chat history remain functional.
- [ ] Tests, typecheck, lint, production build, independent review, migration verification, deployment, and live smoke pass.
