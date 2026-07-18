# Agent Run Stabilization Plan

> **For the implementing agent:** Work on branch `claude/agtentenrun-fehlerprufung-1ubd9q`. Implement task by task, test-first (write the failing test, then the fix), and run the focused vitest file after each step. One commit per task, German imperative subject line matching the existing history style.

**Goal:** Fix three defects in the research agent run (`src/lib/agent.ts` and collaborators):

1. `reasoning_content` is echoed back into follow-up LLM requests — DeepSeek rejects that with HTTP 400, so any multi-iteration tool loop dies in round 2.
2. A single MCP transport failure aborts the entire run and throws away all collected results.
3. Tool results enter the model context uncapped (loop messages and final synthesis), which can overflow the context window.

**Provider assumption:** GLM/Z.AI is **no longer used**. All new behavior targets DeepSeek semantics unconditionally — do **not** add provider branching for Z.AI. Do not remove the existing `zai` provider code either (that is a separate cleanup, out of scope here). The `thinking` / `reasoning_effort` request fields stay unchanged.

**Tech stack:** Next.js 16, TypeScript, Vitest. Verification commands: `npm run typecheck`, `npm run lint`, `npm test` (or `npx vitest run <file>` for focused runs).

---

## Scope and Assumptions

- All line numbers below refer to the current state of the branch; they may drift a few lines — the named functions are the authoritative anchors.
- `researchEvidence` (audit trail, persisted) must keep **raw, untruncated** tool results; only what goes into LLM request payloads gets truncated.
- The result-usability checks (`isUsableGeneralResearchResult`, `isUsableSimpleAmountResult`) must keep running on the **raw** text, before truncation.
- UI step summarization (`summarizeStepText`, 1,200 chars) stays unchanged.
- The `GESETZE` source stays uncapped at the retrieval level (`semantic-tools.ts:141–152`); bounding happens via text truncation only. If practice later shows law results routinely losing relevant text to truncation, a dedicated `GESETZE` result limit is a follow-up ticket, not part of this plan.
- Out of scope: removing GLM models from `MODEL_CATALOG`, the `finish_reason: "stop"`-with-tool-calls issue, the re-query nudge dead end, and the forced-initial-research zero-hit hard failure.

---

## Task 1: Never send `reasoning_content` back to the provider

**Problem:** `runControlledAgent` attaches `reasoning_content` to the assistant message it pushes into the tool-loop history (`src/lib/agent.ts:1619–1630`), and `chatCompletion` serializes messages verbatim (`src/lib/llm/client.ts:92–128`). DeepSeek documents that `reasoning_content` inside input messages returns HTTP 400. The current test `src/lib/agent.test.ts` (~lines 416–468, fixture string `"Unveränderte interne Werkzeugbegründung"`) asserts the buggy echo behavior on purpose — it must be inverted.

**Target behavior:** No outgoing request body ever contains `reasoning_content` in any message. Parsing `reasoning_content` **from responses** (`LlmResult.reasoningContent`) stays as is.

**Files:**
- Modify: `src/lib/agent.ts`
- Modify: `src/lib/llm/client.ts`
- Modify: `src/lib/agent.test.ts`
- Modify: `src/lib/llm/client.test.ts`

**Steps:**
1. Invert the agent test: after a tool-call iteration, the follow-up request's assistant message must contain `content` and `tool_calls` but **no** `reasoning_content` key in any message of the payload. Run it — it must fail.
2. In `runControlledAgent`, remove the spread `...(result.reasoningContent !== null && result.reasoningContent !== undefined ? { reasoning_content: result.reasoningContent } : {})` from the assistant message push (anchor: `tool_calls: selectedToolCalls.map`).
3. Remove the `reasoning_content?: string` field from the `LlmMessage` type in `src/lib/llm/client.ts`. Let the compiler surface any remaining writers; fix them the same way.
4. Defense in depth: in `completionPayload`, map messages through a sanitizer that deletes a `reasoning_content` key if present at runtime (guards future regressions and untyped callers) before assigning `payload.messages`.
5. Add a client test: `chatCompletion` called with a message object that (cast via `as`) carries `reasoning_content` → the JSON body handed to `fetch` contains no `reasoning_content`. Existing response-parsing tests (`client.test.ts:230–254`) stay untouched and must keep passing.
6. Run `npx vitest run src/lib/agent.test.ts src/lib/llm/client.test.ts`.

**Acceptance:** No request payload contains `reasoning_content`; a multi-iteration tool loop against DeepSeek no longer produces HTTP 400; full suite green.

---

## Task 2: Tolerate MCP transport failures instead of aborting the run

**Problem:** In `executeResearchToolCall` (`src/lib/agent.ts:1338–1364`), a thrown MCP error emits a failure step and then rethrows — one unreachable source kills the whole run including all previously collected results. The `simple_amount` branch (~lines 1157–1169) already handles this gracefully; adopt that pattern.

**Target behavior:**
- **Transient failures** (network errors, MCP timeout, MCP HTTP 5xx, "Datenbankantwort ist leer/unvollständig") become a *failed tool result*: `toolLog` entry with `success: false`, a `tool_result` step with `success: false`, and — when `appendToolMessage` is true — a `role: "tool"` message carrying the error text. Protocol consistency is mandatory: **every** `tool_call_id` in the pushed assistant message must receive a tool message, otherwise the next completion request is malformed. The loop continues; the model can switch sources.
- **Fatal failures** keep the current abort behavior: `MissingMcpBearerTokenError` (import from `./errors`), `UserVisibleError` with status 401 or 403 (misconfiguration — every further call would fail identically), and an already-aborted overall deadline (`options.deadline?.signal.aborted`).

**Files:**
- Modify: `src/lib/agent.ts`
- Modify: `src/lib/mcp/client.ts`
- Modify: `src/lib/agent.test.ts`
- Modify: `src/lib/mcp/client.test.ts`

**Steps:**
1. Write failing agent tests:
   - First tool call rejects with a generic `Error("fetch failed")`, model then calls a second source successfully → run completes with an answer; the history contains a `role: "tool"` message for the failed `tool_call_id` whose content names the failure; steps contain a `tool_result` with `success: false`.
   - First tool call rejects with `UserVisibleError(..., 401)` → run still throws.
   - Deadline signal already aborted when the tool call fails → run still throws.
2. Add a private helper in `agent.ts`, e.g. `isFatalResearchToolError(error, deadline)`, implementing the fatal classification above.
3. Restructure the `try/catch` in `executeResearchToolCall`: on a non-fatal error, set `toolResult` to a model-facing text — recommended: `"Diese Recherchequelle ist derzeit nicht erreichbar (<sanitized error message>). Nutze eine andere verfügbare Recherchefunktion."` — mark `success = false`, and fall through to the **shared** tail (toolLog push, `tool_result` step, tool message). Make sure exactly one `tool_result` step is emitted per call: the current catch block emits its own step and throws; after the refactor the shared tail is the only emitter for both outcomes, while the fatal path keeps step + rethrow.
4. Evidence capture must not run for failures (the existing `success && isUsableGeneralResearchResult` guard already ensures this — keep it).
5. In `McpClient.postJson` (`src/lib/mcp/client.ts:234–252`), retry the `fetch` once on `TypeError` (transport failure), mirroring `fetchWithRetry` in `src/lib/llm/client.ts:137–158`: max 2 attempts, never retry when the signal is aborted. Add a focused client test (first fetch throws `TypeError`, second succeeds).
6. Document the accepted interaction with the forced initial research path (`appendToolMessage = false`): a non-fatal failure there yields no usable evidence, so the existing `missingInitialResearchError` gate still fails the run — unchanged and intentional.
7. Run `npx vitest run src/lib/agent.test.ts src/lib/mcp/client.test.ts`.

**Acceptance:** One failing source no longer ends the run; auth/deadline failures still abort; every `tool_call_id` has a matching tool message; full suite green.

---

## Task 3: Deterministic context budget for tool results

**Problem:** Raw tool results flow uncapped into (a) the loop history as `role: "tool"` messages and (b) the final-synthesis prompt via `formatToolLog` (`src/lib/agent.ts:594–608`). Six iterations with several calls each — and `GESETZE` uncapped — can overflow the DeepSeek context window (provider 400 or silent truncation).

**Target behavior:** Hard, deterministic caps on what enters LLM payloads. Raw text is preserved in `researchEvidence` (which has its own audit bounds).

**Design:**
- New module `src/lib/agent-context-budget.ts` (matches the repo's small-module style, unit-testable) exporting:
  - `TOOL_RESULT_CONTEXT_CHAR_LIMIT = 12_000` — per result, applied to loop tool messages and `toolLog` entries.
  - `TOOL_LOG_SYNTHESIS_CHAR_BUDGET = 60_000` — sum of all `result` texts inside the final-synthesis tool log.
  - `TOOL_LOG_MIN_ENTRY_CHARS = 400` — floor when re-shrinking entries to meet the budget.
  - `truncateToolResultForContext(text: string): string` — cuts at the per-result limit and appends `"\n… [gekürzt – vollständige Fundstelle in der gespeicherten Evidenz]"`; returns short texts unchanged.
  - `applyToolLogBudget(entries: Array<{ result: string; success: boolean }>): Array<...>` — keeps chronological order and entry count stable (numbering in the prompt must not shift). If the summed `result` length exceeds the budget: first shrink **failed** entries to the floor (oldest first), then **successful** entries (oldest first), stopping as soon as the budget is met. Never drop an entry entirely. Pure function, no mutation of the input.
  - Rationale for the numbers (put in a code comment): DeepSeek serves a 128k-token context; German legal text runs ≈ 3–4 chars/token. 60k chars ≈ 15–20k tokens for the tool log leaves room for the system prompt, conversation (`MAX_MESSAGES = 20`), research memory (`MAX_MEMORY_CHARS = 10_000`), attachments, and the answer. All three values are tunable constants.
- Integration order inside `executeResearchToolCall` is critical and stays: usability check and `appendResearchEvidence` operate on the **raw** `toolResult`; only afterwards store the **truncated** text in the `toolLog` entry and in the `role: "tool"` message.
- Same treatment in the `simple_amount` branch: `isUsableSimpleAmountResult` and evidence capture on raw text, truncated text into `toolLog`.
- `formatToolLog` first runs `applyToolLogBudget` over the entries, then formats as today.
- `summarizeStepText` for UI steps and the `GESETZE` retrieval limit stay untouched.

**Files:**
- Create: `src/lib/agent-context-budget.ts`
- Create: `src/lib/agent-context-budget.test.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/lib/agent.test.ts`

**Steps:**
1. Write failing unit tests for the new module: text exactly at the limit stays unchanged; text one char over gets cut plus marker; budget algorithm shrinks failed-oldest first, then successful-oldest, keeps order/count, is a no-op when under budget; multi-byte characters don't split the marker logic.
2. Implement `agent-context-budget.ts`.
3. Wire it into `executeResearchToolCall` and the `simple_amount` branch as described. Agent test: an MCP double returning a 200k-char result → the tool message and `toolLog` entry are ≤ limit and end with the marker; `researchEvidence` contains the full raw text; a result whose only hit sits at the end of the raw text is still classified usable.
4. Wire `applyToolLogBudget` into `formatToolLog`. Agent test: several oversized successful and failed entries → the final-synthesis payload's tool-log section respects the budget, numbering unchanged.
5. Integration test through `runAgent`: multiple iterations with huge results → every `chatCompletion` invocation's serialized messages stay bounded (assert on the captured payloads of the fake runtime).
6. Run `npx vitest run src/lib/agent-context-budget.test.ts src/lib/agent.test.ts`.

**Acceptance:** No code path hands a raw, uncapped tool result to an LLM request; evidence/persistence keeps raw text; full suite green.

---

## Task 4: Final verification

1. `npm run typecheck`
2. `npm run lint`
3. `npm test` (full suite)
4. Confirm the three commits exist (one per task) and push the branch.
