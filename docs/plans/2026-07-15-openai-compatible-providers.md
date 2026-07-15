# OpenAI-Compatible Providers Implementation Plan

> **For Hermes:** Execute with Codex CLI through the configured DeepSeek V4 Flash route, then review the final diff with Gemini 3.5 Flash via `agy`.

**Goal:** Remove the LaoZhang-specific integration and let administrators securely create, edit, delete, and scope arbitrary OpenAI-compatible chat-completion entries.

**Architecture:** Keep built-in DeepSeek and Z.AI models unchanged. Represent each custom entry as one opaque `openai:<uuid>` model setting with an upstream model ID, optional display name, normalized base URL, availability (`disabled`, `admins`, or `all`), and an AES-256-GCM encrypted API key. Store ciphertext only in `model_settings`; never copy it into history or return it to the browser. Preserve historical LaoZhang provenance rows while deleting all current LaoZhang settings.

**Tech Stack:** Next.js 16, TypeScript, Node.js crypto, Supabase/PostgreSQL migrations and RPCs, Vitest.

---

## Scope and Assumptions

- One custom provider entry represents one model endpoint configuration.
- `baseUrl` is the OpenAI-compatible API root, for example `https://gateway.example.com/v1`; the runtime appends `/chat/completions`.
- Optional display names fall back to the upstream model ID.
- Availability has three states: `disabled`, `admins`, and `all`.
- A create request requires an API key. An update keeps the existing key when the API-key field is blank and replaces it when a new key is supplied.
- API keys are encrypted with AES-256-GCM using `OPENAI_COMPATIBLE_CREDENTIALS_KEY`, configured only in the production environment.
- Built-in DeepSeek/Z.AI configuration, reasoning controls, and default-model behavior remain unchanged.
- Existing current LaoZhang settings are deleted. Historical `model_settings_history`, `agent_runs`, and `messages` provenance remains valid.

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260715093000_openai_compatible_providers.sql`
- Test: replace LaoZhang-specific migration expectations with a focused migration test under `src/lib/`

**Steps:**
1. Add failing tests for custom-provider columns, constraints, RPCs, access scope, ciphertext isolation, legacy-provenance compatibility, and LaoZhang-current-row cleanup.
2. Add `base_url`, `access_scope`, and `api_key_ciphertext` to current model settings. Add only non-secret metadata to history.
3. Delete current `provider='laozhang'` rows.
4. Replace current dynamic constraints with `openai:<uuid>` / `openai_compatible` rules while preserving historical LaoZhang constraints where required.
5. Replace `create_dynamic_model` with service-role-only create/update/delete RPCs using optimistic revisions.
6. Update provenance constraints to accept new OpenAI-compatible rows and old LaoZhang history.
7. Run focused migration tests.

## Task 2: Secret encryption and generic runtime

**Files:**
- Create: `src/lib/openai-compatible-credentials.ts`
- Modify: `src/lib/config.ts`
- Modify: `src/lib/model-settings.ts`
- Modify: `src/lib/llm/runtime.ts`
- Modify: `src/lib/llm/credentials.ts`
- Modify: `src/lib/llm/client.ts`
- Delete: `src/lib/laozhang-key.ts`
- Delete: `src/lib/laozhang.test.ts`
- Tests: corresponding focused unit tests

**Steps:**
1. Write failing tests for AES-256-GCM round-trip, wrong-key/tamper failure, missing-key failure, and no plaintext exposure.
2. Implement lazy environment-key parsing plus versioned authenticated encryption.
3. Replace LaoZhang provider/runtime branches with `openai_compatible` using per-entry base URL and decrypted key.
4. Keep generic requests on `/chat/completions`, with no provider-specific reasoning fields.
5. Ensure API keys and ciphertext never appear in DTOs, errors, logs, or client payloads.
6. Run focused runtime/model-setting tests.

## Task 3: Admin CRUD and access control

**Files:**
- Modify: `src/app/api/admin/models/route.ts`
- Modify: `src/app/api/admin/models/[modelId]/route.ts`
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/api/chat/route.ts`
- Tests: route tests

**Steps:**
1. Write failing route tests for create, edit, key replacement/retention, delete, validation, revision conflicts, and non-admin rejection.
2. Implement strict request parsing for model ID, optional display name, base URL, API key, availability, and revision.
3. Filter admin-only entries out of normal-user `/api/settings` responses.
4. Enforce the same access rule in `/api/chat`; UI filtering alone is insufficient.
5. Verify deleted/disabled/unauthorized entries cannot be selected directly by model ID.
6. Run focused API tests.

## Task 4: Administration UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Tests: existing release-surface/composer UI tests plus focused source-level behavior tests where established by the repository

**Steps:**
1. Replace all LaoZhang labels, state, handlers, and CSS classes.
2. Add create fields: model ID, optional display name, base URL, API key, and availability.
3. Add inline edit and delete actions for custom entries. Keep the key field blank and label it as optional on edit.
4. Refresh both admin and public settings after each mutation.
5. Keep built-in model controls unchanged and avoid unrelated UI changes.
6. Run focused UI tests.

## Task 5: Cleanup, verification, and deployment

**Steps:**
1. Confirm repository-wide source no longer contains active LaoZhang integration references; only the historical migration and explicitly documented legacy provenance may retain the name.
2. Run focused tests, `npm run typecheck`, `npm run lint`, and `npm run build`.
3. Review the static final diff with Gemini 3.5 Flash via `agy`; fix all Critical/High findings and re-verify.
4. Generate `OPENAI_COMPATIBLE_CREDENTIALS_KEY` without printing it and add it to Coolify.
5. Apply the tracked Supabase migration and verify schema/data invariants.
6. Remove `LAOZHANG_API_KEY` from Coolify after the new deployment is healthy.
7. Push to `main`, monitor Coolify, and verify health.
8. Run production E2E checks for admin CRUD, admin-only visibility, all-user visibility, direct-chat authorization, and deletion using a temporary test entry; remove all test data afterward.
