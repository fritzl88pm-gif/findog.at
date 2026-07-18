# findog.at

Next.js MVP for Findog/Fred, a German-language tax-law chat UI using centrally managed DeepSeek/GLM models and the fixed BFG/WeKnora MCP endpoint.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, sign in to a manually provisioned Supabase account with an email address and password, and choose one of the administrator-enabled models in the chat composer. `deepseek-v4-flash` is the default and remains available; every other model can be enabled or disabled centrally by an administrator. Provider keys are server-side only and users cannot supply or view them. The selected model is stored locally as a browser preference and is checked against the current server-side allowlist for every request. Local chat history is scoped by the authenticated Supabase user ID, and conversation IDs are verified server-side before use. BFG/WeKnora MCP access is fixed server-side and is not configurable by users.

Assistant responses include a streaming agent-step panel with the plan, loaded MCP tools, tool calls, bounded tool-result snippets, optional attachment-context extraction status, BFG citation verification, and the final answer marker.

BFG case citations discovered through the fixed WeKnora/MCP knowledge base are verified server-side against the public Findok resolver (`/findok/api/volltext/gz`) before final output. Final answers may only name verified BFG Geschäftszahlen from the `findok-bfg` index, and verified `RV/...`/`RS/...`/`RM/...`/`AW/...`/`VH/...` citations are rendered as links to the official Findok PDF (`dokumentPdfMediaUrl`). Unverified or missing Findok cases are omitted from the final answer rather than linked or shown as plain citations.

## Environment

Copy `.env.example` to `.env.local` and configure Supabase Auth before using the chat.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL for password authentication. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anon key for Auth calls. Do not use a service role key here. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL for validating Auth access tokens and chat persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key. Never expose it to the browser. |
| `DEEPSEEK_API_KEY` | Yes | Server-only DeepSeek API key used for the supported v4 Flash/Pro models. Never expose it to the browser. |
| `GLOBAL_DEEPSEEK_API_KEY` | Optional | Fallback server-only DeepSeek key if `DEEPSEEK_API_KEY` is unset or blank. |
| `ZAI_API_KEY` | For enabled GLM models | Server-only GLM Coding Plan key. Store it as a protected Coolify runtime variable; never use a `NEXT_PUBLIC_` prefix. |
| `BFG_MCP_BEARER_TOKEN` | Yes | Server-only bearer token for the fixed BFG/WeKnora MCP endpoint. Never expose it to the browser. |
| `WEKNORA_FRED_CHANNEL_ID` | For Fred Web Embed | Public identifier of Fred's enabled WeKnora embed channel. Kept server-side so the browser receives it only with a short-lived session. |
| `WEKNORA_FRED_PUBLISH_TOKEN` | For Fred Web Embed | Server-only long-lived channel publish token with the `em_` prefix. This is not an account API key (`sk_`) and must never use a `NEXT_PUBLIC_` prefix. |
| `WEKNORA_FRED_EXCHANGE_ORIGIN` | For Fred Web Embed | Exact Findog origin registered in the channel allowlist; production defaults to `https://findog.at`. |
| `OPENROUTER_API_KEY` | Yes for PDF/image uploads | Server-only OpenRouter key used only for fixed Gemini 3.5 Flash attachment/OCR context extraction. Never expose it to the browser. |

DeepSeek uses `https://api.deepseek.com`; GLM uses the dedicated Coding Plan endpoint `https://api.z.ai/api/coding/paas/v4`. Both use OpenAI-compatible `POST /chat/completions`. The fixed server catalog contains `deepseek-v4-flash`, `deepseek-v4-pro`, `glm-5.2`, and `glm-5-turbo`. Arbitrary client model IDs, endpoints, and API keys are rejected. Availability and supported reasoning settings are resolved server-side for every run.

Fred's WeKnora page uses Secure Mode: Findog exchanges the long-lived `em_` publish token only on the server and hands the browser a short-lived `ems_` session through a verified `postMessage` channel. The Taxdog iframe runs credentialless so its channel-scoped storage cannot cross Findog accounts; the app reloads the top-level document on sign-out/account changes. This privacy boundary currently requires a Chromium browser. Because credentialless storage is page-lifetime only, a full Findog reload starts a fresh visible Fred conversation, and popup-based OAuth inside the iframe is unavailable.

PDF and image uploads are handled as a separate fixed server-side context layer: the browser sends up to five `application/pdf` attachments and up to five image attachments with the chat payload, the server sends each file to OpenRouter model `google/gemini-3.5-flash` for OCR/document or image extraction, and the extracted Markdown contexts are passed to the selected enabled chat model. The existing 50 MB per-PDF limit still applies; images are capped at 5 MB each. There is no page-count gate before extraction. Gemini does not produce the final chat answer.

## Authentication

Harald provisions authorized accounts manually. Findog supports only email/password sign-in and has no public registration. The Einstellungen dialog contains only password change and confirmed permanent account deletion. Model selection remains in the chat composer.

## Supabase Migration

Apply all migrations in order through the Supabase SQL editor or your migration flow:

1. `supabase/migrations/0001_chat_history.sql`
2. `supabase/migrations/0002_agent_runs.sql`
3. `supabase/migrations/0003_admin_settings.sql`
4. `supabase/migrations/0004_admin_user_management.sql`
5. `supabase/migrations/0005_remove_global_system_prompt_length_limit.sql`
6. `supabase/migrations/20260714195644_central_model_settings.sql`
7. `supabase/migrations/20260714205842_lock_down_chat_tables.sql`
8. `supabase/migrations/20260714205944_index_model_provenance_fks.sql`
9. `supabase/migrations/20260715000000_agent_feedback.sql`
10. `supabase/migrations/20260715000001_laozhang_dynamic_models.sql`
11. `supabase/migrations/20260715093000_openai_compatible_providers.sql`
12. `supabase/migrations/20260715171030_global_default_and_model_icons.sql`
13. `supabase/migrations/20260715172808_index_model_default_policy_fk.sql`
14. `supabase/migrations/20260718000000_document_artifacts.sql`
15. `supabase/migrations/20260718100000_research_result_limit.sql`

Supabase Auth must be enabled for email/password login. Authorized accounts are manually provisioned; the app does not expose self-service registration. Server persistence stores the authenticated Supabase `user.id` as `conversations.client_id`, `messages.client_id`, and `agent_runs.client_id`. Deleting an owned conversation cascades to its messages, agent runs, and agent steps. The admin request audit records only submitted user prompts and is deliberately independent of conversation deletion; deleting the audit history does not remove a user's conversations.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deployment

Deploy the Next.js application through Coolify. Configure the Supabase variables plus `DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `BFG_MCP_BEARER_TOKEN`, the three `WEKNORA_FRED_*` values, and any attachment-processing key as protected runtime environment variables. The Fred channel allowlist must include `https://taxdog.cloud` and the exact Findog exchange origin (plus the local origin only while testing). Do not expose provider keys as build arguments or `NEXT_PUBLIC_` variables. Restart or redeploy the application after changing a runtime variable. Users never provide provider keys in the authenticated UI.
