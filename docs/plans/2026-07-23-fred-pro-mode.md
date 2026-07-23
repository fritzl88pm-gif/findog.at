# Fred Pro Mode Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a `Pro` toggle immediately before the existing web-search control so a Findog chat turn continues through the same Fred agent and session but uses `deepseek-v4-pro` for Fred's agent reasoning and answer generation.

**Architecture:** Keep the existing Fred agent, secure embed channel, conversation, tools, prompt, knowledge bases, and history. Findog sends a fixed server-side `summary_model_id` override only when Pro mode is enabled; normal turns continue to send an empty override and therefore use Fred's configured `deepseek-v4-flash` model. Persist the Pro flag as request metadata so history, edit, regenerate, and PDF export remain truthful.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Vitest, Supabase/PostgreSQL, WeKnora secure embed API, Coolify.

---

## Verified feasibility

- Current Findog/production revision: `c929fba56a7cc86da4e2e3a31d39db8d9054960c`.
- Fred agent ID: `e8b65a4d-dc41-4281-ba62-e01e50b0947a`.
- Fred remains configured with:
  - `agent_mode="smart-reasoning"`
  - `thinking=true`
  - `max_iterations=40`
  - `llm_call_timeout=120`
  - default model `deepseek-v4-flash`
- Active Pro model:
  - name: `deepseek-v4-pro`
  - model ID: `8bf35269-0358-41a7-86c0-f735ba4fb507`
  - model thinking transport: `extra_config.thinking_control="enable_thinking"`
- WeKnora AgentQA explicitly supports a per-request `summary_model_id` which overrides the custom agent's `config.model_id` without modifying the agent.
- WeKnora's secure embed payload patch preserves `summary_model_id`; it only enforces the channel-bound agent, knowledge scope, web-search permission, memory, attachments, MCP services, and agent mode.
- The existing Findog client already sends `summary_model_id: ""`; replacing that value conditionally is a narrow supported path.

## Meaning of “max reasoning”

The current DeepSeek/WeKnora integration exposes a boolean thinking control, not a numeric `reasoning_effort=max` field. Therefore Pro mode means:

- same Fred `smart-reasoning` agent;
- same maximum configured agent loop of 40 iterations;
- Fred's existing `thinking=true` remains active;
- `deepseek-v4-pro` receives `enable_thinking=true`;
- no invented or unsupported `reasoning_effort` parameter is sent.

This is the strongest reasoning mode supported by the current live Fred and model configuration. Async conversation-title generation may continue to use Fred's default Flash model; the user-facing agent run uses the Pro override.

## UX contract

1. Add a compact text button labelled `Pro` immediately before `Websuche` in `composer-actions`.
2. Use `aria-pressed`, `aria-label`, and `title`:
   - inactive: `Pro-Modus verwenden`
   - active: `Pro-Modus aktiv`
3. Use the existing `composer-model-trigger` dimensions and focus behavior.
4. Give the active state a clear premium accent, preferably the existing deep blue with a restrained violet highlight; no animation, counter, settings panel, or explanatory banner.
5. Pro and web search are independent and may both be active.
6. Keep Fred as sender and preserve the current Fred avatar, research trace, citations, and error wording.
7. Add a compact `Pro` badge to the corresponding user message and `Pro-Modus: aktiviert` to conversation PDF metadata.
8. Keep the toggle active after sending until the user turns it off, matching the existing web-search toggle behavior.
9. Hide the button when the server-side Pro model ID is not configured.

## Acceptance criteria

- Default requests continue to use Fred with `summary_model_id: ""`.
- Pro requests use the same Fred agent/session with `summary_model_id="8bf35269-0358-41a7-86c0-f735ba4fb507"`.
- The browser sends only `proModeEnabled: boolean`; it never receives the model ID, channel ID, publish token, session signature, or WeKnora credentials.
- Invalid non-boolean values return HTTP 400.
- Pro can be combined with web search and attachment preprocessing.
- The Pro flag survives history reload, edit, regenerate, and PDF export.
- Existing conversations and messages default to non-Pro without data loss.
- Fred's live agent configuration is never modified.
- No new WeKnora agent, channel, session mapping, or Core patch is required.

---

### Task 1: Add a server-only Pro model configuration

**Objective:** Resolve the exact Pro model ID on the server without exposing it to the browser.

**Files:**
- Modify: `src/lib/weknora/fred-embed.ts`
- Modify: `src/lib/weknora/fred-embed.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Step 1: Write failing tests**

Add tests for:

```ts
readFredProModelId({
  WEKNORA_FRED_PRO_MODEL_ID: "8bf35269-0358-41a7-86c0-f735ba4fb507",
});
```

Require:

- a canonical UUID is accepted;
- blank, malformed, path-like, or non-UUID values fail closed;
- the existing Fred channel/token/origin parser remains unchanged;
- no model ID is added to any client-visible object.

**Step 2: Run the focused test**

```bash
npm test -- src/lib/weknora/fred-embed.test.ts
```

Expected: FAIL because the Pro model parser does not exist.

**Step 3: Implement the minimal parser**

```ts
export function readFredProModelId(
  environment: Record<string, string | undefined> = process.env,
): string {
  const modelId = environment.WEKNORA_FRED_PRO_MODEL_ID?.trim() ?? "";
  if (!UUID_PATTERN.test(modelId)) throw new FredEmbedConfigurationError();
  return modelId;
}
```

Use the existing UUID validation convention in the repository. Do not accept model names or arbitrary client values.

**Step 4: Document configuration**

Add to `.env.example` and `README.md`:

```text
WEKNORA_FRED_PRO_MODEL_ID=
```

State that it is server-only, non-secret, and must resolve live to the exact active `deepseek-v4-pro` KnowledgeQA model.

**Step 5: Verify**

```bash
npm test -- src/lib/weknora/fred-embed.test.ts
npm run typecheck
```

---

### Task 2: Add the model override to the existing Fred upstream request

**Objective:** Select Pro per request while keeping the Fred agent/channel/session unchanged.

**Files:**
- Modify: `src/lib/weknora/fred-native.ts`
- Modify: `src/lib/weknora/fred-native.test.ts`

**Step 1: Write failing request-body tests**

Extend the existing `openFredUpstreamStream` test matrix:

```ts
await openFredUpstreamStream({
  ...baseOptions,
  summaryModelId: "8bf35269-0358-41a7-86c0-f735ba4fb507",
});
```

Assert the outgoing JSON contains:

```json
{
  "agent_id": "the existing Fred agent ID",
  "agent_enabled": true,
  "summary_model_id": "8bf35269-0358-41a7-86c0-f735ba4fb507"
}
```

Also assert normal mode sends:

```json
{ "summary_model_id": "" }
```

Verify the endpoint, channel, signed session, visitor ID, KB scope, web-search flag, and attachment exclusions are otherwise identical.

**Step 2: Run and verify failure**

```bash
npm test -- src/lib/weknora/fred-native.test.ts
```

**Step 3: Implement the single-field override**

Add `summaryModelId: string` to `openFredUpstreamStream` and replace the current hardcoded empty value:

```ts
summary_model_id: options.summaryModelId,
```

Do not change the agent ID, channel, model row, Fred config, or session handling.

**Step 4: Verify**

```bash
npm test -- src/lib/weknora/fred-native.test.ts
npm run typecheck
```

---

### Task 3: Persist Pro mode as bounded request metadata

**Objective:** Preserve mode identity across reload, edit, regenerate, and PDF export without changing conversation ownership or upstream sessions.

**Files:**
- Create: `supabase/migrations/20260723123000_fred_pro_mode.sql`
- Create: `src/lib/fred-pro-mode-migration.test.ts`
- Modify: `src/lib/fred-native-attachment-migration.test.ts`
- Modify: `src/lib/fred-research-migration.test.ts`

**Step 1: Write the migration tests**

Require:

```sql
alter table public.fred_messages
  add column pro_mode_enabled boolean not null default false;
```

Add a role constraint analogous to web search:

```sql
role = 'user' or pro_mode_enabled = false
```

Existing rows must remain `false`; no messages or conversations are rewritten or deleted.

**Step 2: Replace only the latest native metadata function**

Create or replace `public.record_fred_native_event(payload jsonb)` while preserving every current validation from `20260719084653_fred_research_trace_and_citations.sql`.

Add:

- strict boolean validation for `pro_mode_enabled`;
- default `false` for omitted values;
- assistant events must always store `false`;
- metadata-reuse/idempotency comparison includes the Pro flag;
- final update writes `pro_mode_enabled` beside attachments and web search.

Do not alter `record_fred_bridge_event`, `record_fred_webhook_event`, ownership, session binding, webhook provenance, or RLS grants.

**Step 3: Verify migration tests**

```bash
npm test -- \
  src/lib/fred-pro-mode-migration.test.ts \
  src/lib/fred-native-attachment-migration.test.ts \
  src/lib/fred-research-migration.test.ts
```

---

### Task 4: Validate and route Pro mode in the Fred chat API

**Objective:** Convert the browser boolean into the fixed server-only model override and persist it with the user turn.

**Files:**
- Modify: `src/app/api/fred/chat/route.ts`
- Modify: `src/app/api/fred/chat/route.test.ts`

**Step 1: Write failing route tests**

Cover:

- omitted `proModeEnabled` defaults to `false`;
- `true` loads the configured Pro model ID and passes it to `openFredUpstreamStream`;
- `false` passes an empty override;
- strings, numbers, null, model names, and UUID fields supplied under any other key are rejected or ignored according to the existing request contract;
- web search remains independently enabled;
- attachments still produce the same bounded combined query and no native binary fields;
- the persisted user event contains `pro_mode_enabled:true` only for Pro mode;
- assistant persistence remains `false`;
- abort, timeout, BFG citation verification, research events, and final answer persistence remain unchanged.

**Step 2: Extend the validated request type**

```ts
type ParsedFredChatRequest = {
  query: string;
  conversationId: string;
  webSearchEnabled: boolean;
  proModeEnabled: boolean;
  attachments: FindogAttachment[];
};
```

Reject a present non-boolean value with HTTP 400.

**Step 3: Resolve the override server-side**

```ts
const summaryModelId = body.proModeEnabled
  ? readFredProModelId()
  : "";
```

Pass only this resolved value to `openFredUpstreamStream`.

**Step 4: Persist metadata**

Add `proModeEnabled?: boolean` to `recordEvent` options and include:

```ts
pro_mode_enabled: options.proModeEnabled ?? false,
```

Only the user event receives the request's true value.

**Step 5: Verify**

```bash
npm test -- src/app/api/fred/chat/route.test.ts
npm run typecheck
```

---

### Task 5: Expose only a Pro capability boolean

**Objective:** Hide the control when production configuration is incomplete without exposing the model ID.

**Files:**
- Modify: `src/app/api/fred/capabilities/route.ts`
- Modify: `src/app/api/fred/capabilities/route.test.ts`

**Step 1: Write failing tests**

Require the authenticated response shape:

```json
{
  "webSearch": true,
  "fileUpload": true,
  "proMode": true
}
```

Verify:

- valid server-side Pro model configuration returns `proMode:true`;
- missing/invalid Pro configuration returns `proMode:false` without breaking Fred's other capabilities;
- response contains no model ID, agent ID, channel ID, token, origin, or diagnostics;
- cache remains `private, no-store`.

**Step 2: Implement graceful capability detection**

Catch only the optional Pro configuration error and map it to `false`. Keep current Fred capability failures unchanged.

**Step 3: Verify**

```bash
npm test -- src/app/api/fred/capabilities/route.test.ts
```

---

### Task 6: Add the Pro button before Websuche

**Objective:** Add the requested control without changing the chat layout or Fred identity.

**Files:**
- Modify: `src/components/fred-native-chat-view.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/lib/fred-native-ui.test.ts`
- Modify: `src/lib/chat/fred-actions.ts`
- Modify: `src/lib/chat/fred-actions.test.ts`

**Step 1: Write failing UI tests**

Assert:

- `FredCapabilities` includes `proMode`;
- `FredNativeMessage` includes `proModeEnabled?: boolean`;
- the `Pro` button appears before the existing Websuche button;
- it uses `aria-pressed`, dynamic label/title, and is disabled while sending;
- Pro and web search can both be active;
- `requestPayload.proModeEnabled` is always a boolean;
- no model ID appears in the component source or browser payload;
- edit and regenerate restore the original user turn's Pro flag;
- the user message renders a `Pro` badge;
- conversation PDF metadata includes `Pro-Modus: aktiviert`;
- the assistant sender remains `Fred`.

**Step 2: Add minimal state**

```ts
const [proModeEnabled, setProModeEnabled] = useState(false);
```

Keep it independent from `webSearchEnabled` and preserve it after sending.

**Step 3: Thread the flag through existing actions**

Add it to:

- `submitQuery` options;
- optimistic user message metadata;
- JSON and multipart request payloads;
- `editQuestion`;
- `regenerateAnswer`;
- history normalization in `page.tsx`;
- PDF metadata in `fred-actions.ts`.

Do not add it to the assistant identity or create a second agent label.

**Step 4: Add scoped styling**

Place `.fred-pro-toggle` beside the existing `.fred-web-search-toggle` rules. Preserve current height, padding, focus ring, mobile wrapping, and specificity protections.

**Step 5: Verify**

```bash
npm test -- \
  src/lib/fred-native-ui.test.ts \
  src/lib/chat/fred-actions.test.ts
npm run typecheck
```

---

### Task 7: Return Pro metadata from stored history

**Objective:** Restore the Pro badge and regeneration behavior after reloading a conversation.

**Files:**
- Modify: `src/app/api/fred/conversations/[conversationId]/route.ts`
- Modify: `src/app/api/fred/conversations/[conversationId]/route.test.ts`

**Step 1: Write failing history tests**

Require the query to select `pro_mode_enabled` and return:

```json
{
  "role": "user",
  "proModeEnabled": true
}
```

Assistant and legacy messages return `false` or omit the field consistently with existing optional metadata conventions.

**Step 2: Implement mapping only**

Keep citation reconstruction, attachment metadata, web-search metadata, ordering, ownership checks, and delete behavior unchanged.

**Step 3: Verify**

```bash
npm test -- 'src/app/api/fred/conversations/[conversationId]/route.test.ts'
```

---

### Task 8: Run release and production verification

**Objective:** Prove exact model routing and preserve the existing Fred production path.

**Step 1: Focused suite**

```bash
npm test -- \
  src/lib/weknora/fred-embed.test.ts \
  src/lib/weknora/fred-native.test.ts \
  src/app/api/fred/chat/route.test.ts \
  src/app/api/fred/capabilities/route.test.ts \
  'src/app/api/fred/conversations/[conversationId]/route.test.ts' \
  src/lib/fred-native-ui.test.ts \
  src/lib/chat/fred-actions.test.ts \
  src/lib/fred-pro-mode-migration.test.ts
```

**Step 2: Full repository gate**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

**Step 3: Independent review**

Use Gemini 3.6 Flash High to review the final diff for:

- client-controlled model IDs;
- accidental Fred-agent mutation;
- Pro override sticking to later normal requests;
- mode loss on regenerate/history reload;
- incomplete migration/idempotency checks;
- secret or model-ID exposure;
- composer accessibility/mobile regressions.

Fix Critical/High findings before deployment and report Medium/Low findings.

**Step 4: Apply the Supabase migration**

Before deployment, verify:

- existing message count unchanged;
- every existing row has `pro_mode_enabled=false`;
- no conversation, message, attachment, research trace, or source reference changed.

**Step 5: Configure Coolify safely**

Set through Coolify's supported encrypted environment-variable path:

```text
WEKNORA_FRED_PRO_MODEL_ID=8bf35269-0358-41a7-86c0-f735ba4fb507
```

Do not write plaintext directly into Coolify's encrypted database column.

**Step 6: Deploy and verify exact revision**

Confirm the queued commit, terminal deployment success, healthy container, and image tag matching the deployed commit.

**Step 7: Authenticated browser smoke**

1. Confirm Pro appears immediately before Websuche.
2. Send the same bounded tax question once with Pro off and once with Pro on.
3. Verify normal request body uses an empty server-side model override.
4. Verify Pro request uses the exact live `deepseek-v4-pro` model ID through request-scoped WeKnora logs; never infer routing from answer style alone.
5. Verify logs show Fred's existing agent ID and `smart-reasoning` mode in both runs.
6. Verify Pro retains `thinking=true`; do not claim a nonexistent numeric reasoning effort.
7. Activate Pro and Websuche together and verify both flags reach their intended server-side paths.
8. Verify reload restores the Pro badge.
9. Verify regenerate preserves the original mode.
10. Verify attachment preprocessing and Stop still work.
11. Verify no model IDs or WeKnora credentials appear in browser responses, page source, or client logs.

---

## Explicit non-goals

- No QuickFred integration in this phase.
- No new WeKnora agent or embed channel.
- No Fred configuration/model mutation.
- No new conversation/session mapping.
- No model selector or arbitrary model ID accepted from the browser.
- No automatic fallback from Pro to Flash; failures remain explicit.
- No invented `reasoning_effort=max` parameter.
- No redesign of the composer, research trace, citations, attachments, history, or PDF UI.
