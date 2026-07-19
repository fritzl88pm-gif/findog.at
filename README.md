# findog.at

Next.js application for Findog/Fred, a German-language tax-law assistant using WeKnora for Fred, Gemini via OpenRouter for Scanning, DeepSeek for BFG Suche PRO, and Supabase for authentication and durable chat history.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and sign in with a manually provisioned Supabase email/password account. The first authenticated view is the native Fred chat. Fred's messages, files and optional web-search flag are sent to WeKnora through authenticated server routes; WeKnora credentials and session bindings remain server-side. Scanning, BFG Suche PRO and the form tools remain separate application features.

## Environment

Copy `.env.example` to `.env.local` and configure Supabase Auth before using the chat.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL for password authentication. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anon key for Auth calls. Do not use a service role key here. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL for validating Auth access tokens and chat persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key. Never expose it to the browser. |
| `DEEPSEEK_API_KEY` | For BFG Suche PRO | Server-only DeepSeek API key used for BFG Suche PRO. Never expose it to the browser. |
| `GLOBAL_DEEPSEEK_API_KEY` | Optional | Fallback server-only DeepSeek key if `DEEPSEEK_API_KEY` is unset or blank. |
| `WEKNORA_FRED_CHANNEL_ID` | For native Fred chat | Identifier of Fred's enabled WeKnora embed channel. It remains server-side. |
| `WEKNORA_FRED_PUBLISH_TOKEN` | For native Fred chat | Server-only long-lived channel publish token with the `em_` prefix. This is not an account API key (`sk_`) and must never use a `NEXT_PUBLIC_` prefix. |
| `WEKNORA_FRED_EXCHANGE_ORIGIN` | For native Fred chat | Exact Findog origin registered in the channel allowlist; production defaults to `https://findog.at`. |
| `WEKNORA_FRED_WEBHOOK_SECRET` | For durable Fred history | Server-only HMAC secret shared with Fred's WeKnora webhook. Use at least 32 random characters. |
| `OPENROUTER_API_KEY` | For Scanning and image-assisted forms | Server-only OpenRouter key used by Gemini 3.5 Flash for Scanning and by the form image extraction flow. Never expose it to the browser. |

Fred uses Findog's native chat surface. The authenticated `/api/fred/chat` proxy exchanges the long-lived `em_` publish token server-side, creates or resumes the user-owned WeKnora session, streams Fred's answer and structured research events as NDJSON, and persists both sides of the turn. Findog renders deterministic German research summaries instead of exposing raw model reasoning or tool arguments. Complete BFG business numbers are verified against the official Findok API while the answer streams; verified citations become official Findok full-text links, while unresolved citations remain unchanged and unlinked. WeKnora's internal `<kb ... />` and `<web ... />` citation tags are removed from the visible answer while their source metadata and the unchanged provider answer remain stored for provenance. Neither the short-lived `ems_` token nor the signed WeKnora session handle reaches the browser. There is no Taxdog iframe or cross-origin browser storage.

Fred history is stored separately from the internal agent history, with explicit WeKnora channel/session provenance. Configure the WeKnora channel to POST `message_sent` and `message_received` events to `https://findog.at/api/webhooks/weknora` and use the same `WEKNORA_FRED_WEBHOOK_SECRET` for its `X-WeKnora-Signature` HMAC. The authenticated server proxy binds every WeKnora session to exactly one Findog user before sending the question. Signed webhook deliveries remain an independent audit and reconciliation path. The sidebar supports opening, continuing, selecting, and deleting Fred histories in the same native UI.

Scanning is a one-shot batch evaluation and does not create a chat history. An authenticated user can submit up to five JPEG, PNG, WebP or GIF images (5 MiB each) and five PDFs (10 MiB each). The server validates counts, MIME types, file signatures and request size, detects byte-identical duplicates by SHA-256, and sends the complete unique batch directly as Base64 data in one request to `google/gemini-3.5-flash` through OpenRouter. It does not use OpenRouter's persistent file upload or a restrictive structured-output schema. Gemini inspects every PDF page, including rotated pages, recognizes invoices spanning multiple pages and returns every invoice line item in a German Markdown table. Displayed subtotals, taxes and total or payment amounts are appended as rows of the same table. The output deliberately omits address, payment, invoice-number and other metadata blocks. It must not summarize, sample or merge line items; a completeness check in the prompt requires the table's item count to match the detected document count. Foreign-language item descriptions are translated into German while item numbers, names, quantities, prices, amounts and currencies remain unchanged. Files and reports remain in the current browser workflow only and are never written to Supabase. The resulting report can be exported through the existing authenticated PDF tool.

## Authentication

Harald provisions authorized accounts manually. Findog supports only email/password sign-in and has no public registration. The Einstellungen dialog contains only password change and confirmed permanent account deletion. Fred has no client-side model selection.

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
16. `supabase/migrations/20260718133121_research_evidence_memory_cards.sql`
17. `supabase/migrations/20260719012227_weknora_fred_chat_history.sql`
18. `supabase/migrations/20260719012331_fred_chat_history_fk_indexes.sql`
19. `supabase/migrations/20260719072643_fred_native_attachment_metadata.sql`
20. `supabase/migrations/20260719084653_fred_research_trace_and_citations.sql`

Supabase Auth must be enabled for email/password login. Authorized accounts are manually provisioned; the app does not expose self-service registration. Server persistence stores the authenticated Supabase `user.id` as `conversations.client_id`, `messages.client_id`, and `agent_runs.client_id`. Fred sessions and messages use separate `fred_*` tables and retain their bridge/webhook provenance. For assistant messages, `content` remains the original provider answer; `display_content`, `research_trace`, `source_references`, and `content_transformation` record the bounded native presentation separately. Deleting an owned conversation cascades to its messages, agent runs, and agent steps; deleting a Fred conversation cascades to its Fred messages and processed webhook events. The admin request audit records only submitted user prompts and is deliberately independent of conversation deletion; deleting the audit history does not remove a user's conversations.

Successful research results are stored separately from the 1,200-character agent-step preview. One additional batched, non-reasoning LLM call can create up to ten compact Memory Cards per run. Opaque MCP text remains a non-authoritative discovery hint and is requeried before legal use; only deterministically typed RIS/EVI evidence with the exact matching Stichtag can become reusable legal memory.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deployment

Deploy the Next.js application through Coolify. Configure the Supabase variables, `DEEPSEEK_API_KEY` for BFG Suche PRO, `OPENROUTER_API_KEY` for Scanning and image-assisted forms, and all four `WEKNORA_FRED_*` values as protected runtime environment variables. The Fred channel allowlist must include the exact Findog exchange origin (plus the local origin only while testing). Do not expose provider keys as build arguments or `NEXT_PUBLIC_` variables. Restart or redeploy the application after changing a runtime variable. The Coolify reverse proxy must accept request bodies of at least 100 MiB so that a valid maximum Scanning batch, including multipart overhead, reaches the application.

The native Fred chat mirrors the WeKnora embed capabilities configured for its channel and agent. When enabled upstream, users can request web search and attach up to five images (JPEG, PNG, GIF, or WebP; 10 MB each) plus five documents (`pdf`, `doc`, `docx`, `txt`, `md`, `csv`, `xlsx`, `xls`, `ppt`, or `pptx`; 20 MB each). Files are forwarded to WeKnora for the current request only. Findog stores auditable attachment metadata (name, MIME type, size, SHA-256) and the web-search flag with the user message, but not the binary file or data URI.
