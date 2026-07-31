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
| `WEKNORA_FRED_PRO_MODEL_ID` | For Fred Pro Mode | Server-only exact active deepseek-v4-pro KnowledgeQA model ID (canonical UUID). Non-secret, do not expose to the browser. When set, Fred Pro Mode and its `summary_model_id` are available. |
| `WEKNORA_QUICKFRED_CHANNEL_ID` | For QuickFred | Identifier of QuickFred's dedicated enabled WeKnora embed channel. |
| `WEKNORA_QUICKFRED_PUBLISH_TOKEN` | For QuickFred | Server-only `em_` publish token for the dedicated QuickFred channel. |
| `WEKNORA_QUICKFRED_EXCHANGE_ORIGIN` | For QuickFred | Exact Findog origin registered in the QuickFred channel allowlist. |
| `WEKNORA_QUICKFRED_AGENT_ID` | For QuickFred | Expected canonical QuickFred agent UUID. Requests fail closed if the channel reports a different agent. |
| `TELEGRAM_CREDENTIALS_KEY` | For Telegram | Server-only 32-byte key encoded as canonical standard Base64. Generate it with `openssl rand -base64 32`. Both the web and worker services use it for AES-256-GCM bot-token encryption. Never expose it to the browser. |
| `TELEGRAM_PUBLIC_ORIGIN` | For Telegram | Public HTTPS origin used to register owner-specific Telegram webhooks; production is `https://findog.at`. |
| `TELEGRAM_WORKER_CONCURRENCY` | Telegram worker | Number of concurrently processed jobs. The production default is `2`. |
| `TELEGRAM_WORKER_PORT` | Telegram worker | Private health-listener port. The worker must not have a public domain. |
| `OPENROUTER_API_KEY` | For Scanning and image-assisted forms | Server-only OpenRouter key used by Gemini 3.5 Flash for Scanning and by the form image extraction flow. Never expose it to the browser. |

Fred uses Findog's native chat surface. The authenticated `/api/fred/chat` proxy exchanges the long-lived `em_` publish token server-side, creates or resumes the user-owned WeKnora session, streams Fred's answer and structured research events as NDJSON, and persists both sides of the turn. Findog renders deterministic German research summaries instead of exposing raw model reasoning or tool arguments. Complete BFG business numbers are verified against the official Findok API while the answer streams; verified citations become official Findok full-text links, while unresolved citations remain unchanged and unlinked. WeKnora's internal `<kb ... />` and `<web ... />` citation tags are removed from the visible answer while their source metadata and the unchanged provider answer remain stored for provenance. Neither the short-lived `ems_` token nor the signed WeKnora session handle reaches the browser. There is no Taxdog iframe or cross-origin browser storage.

Fred Pro Mode is a server-only capability that resolves a fixed model ID from `WEKNORA_FRED_PRO_MODEL_ID` (a canonical UUID for the active deepseek-v4-pro KnowledgeQA model) and sends it as `summary_model_id` to WeKnora. The browser provides only a `proModeEnabled: boolean` flag; the server resolves the model ID, never exposing it in capability responses. Pro mode can be combined with web search. When the optional `WEKNORA_FRED_PRO_MODEL_ID` is missing, invalid, or absent, Pro mode returns `false` in capabilities, normal requests send an empty `summary_model_id`, and the existing behavior is unchanged.

QuickFred is an optional, immutable conversation mode backed by a dedicated secure embed channel. A new conversation starts with Fred unless the browser sends `quickFredEnabled:true` on its first turn. The server then stores `agent_key`, the live WeKnora agent ID, channel and session on the conversation; every later turn is routed from that stored binding and a contradictory browser flag is rejected. Fred Pro is unavailable in QuickFred conversations. The lightning control remains visible but locked after the first persisted turn. QuickFred credentials and identifiers never appear in browser capability or stream responses.

Fred history is stored separately from the internal agent history, with explicit WeKnora channel/session provenance. Configure the WeKnora channel to POST `message_sent` and `message_received` events to `https://findog.at/api/webhooks/weknora` and use the same `WEKNORA_FRED_WEBHOOK_SECRET` for its `X-WeKnora-Signature` HMAC. The authenticated server proxy binds every WeKnora session to exactly one Findog user before sending the question. Signed webhook deliveries remain an independent audit and reconciliation path. The sidebar supports opening, continuing, selecting, and deleting Fred histories in the same native UI. Fred answers and individual tables can be copied directly. Selected text within a completed Fred answer exposes a custom right-click action that saves exactly that text as a user-owned reasoning card after the user enters a title and chooses an existing or new category. Completed answers also expose local thumbs-up and thumbs-down controls; thumbs-down opens an explanation field, stores the authenticated negative report in `agent_feedback`, and makes it available in the protected administration feedback tab. Questions can be loaded back into the composer for editing, and the latest answer can be requested again without overwriting the existing audited history. Individual answers and the complete visible conversation can be exported through the authenticated PDF tool.

Scanning is a one-shot batch evaluation and does not create a chat history. An authenticated user can submit up to five JPEG, PNG, WebP or GIF images (5 MiB each) and five PDFs (10 MiB each), plus an optional instruction of up to 1,000 characters for filters such as only pharmacy, office-supply or Amazon invoices. The server validates counts, MIME types, file signatures, instructions and request size, detects byte-identical duplicates by SHA-256, and sends the complete unique batch directly as Base64 data to `google/gemini-3.5-flash` through OpenRouter. It does not use OpenRouter's persistent file upload or a restrictive structured-output schema. Gemini inspects every PDF page, including rotated pages, treats a multi-page invoice as one document and creates meaningful content categories such as medical fees, specialist literature, orders, travel costs or office supplies. Each category receives a chronological Markdown table; unassignable documents go into “Sonstiges”. Recurring service invoices occupy one row per invoice. Product-oriented cash-register, pharmacy and shopping receipts instead expand every product line across all receipt pages into its own row, including amount-changing discounts or fees, without adding the parent receipt again. Each category ends with a total, and different currencies are kept in separate tables. A missing document date becomes `–` in that row and does not invalidate the report. The output deliberately omits individual invoice headings as well as address, payment, invoice-number and other metadata blocks. A completeness check requires every in-scope document and every required product line to appear exactly once. Before display, an output gate retains only valid four-column result tables and removes HTML fragments, tagged reasoning and plain-text work notes. If the first response contains no valid result table, Scanning automatically makes one fresh bounded attempt; a second invalid response becomes a safe error instead of exposing model deliberation. Files, instructions and reports remain in the current browser workflow only and are never written to Supabase. The resulting report can be exported through the existing authenticated PDF tool.

Begründungen is a private, user-scoped card library for reusable reasoning text. Users can create, edit and delete their own cards, copy the reasoning body without its title or categories, create, rename and delete their own categories, assign each card to multiple categories and filter the library by category. Categories are organizational metadata only; deleting one removes its assignments but preserves the cards. Authenticated browsers use server routes rather than direct table access. The atomic save RPC validates category ownership before replacing a card's category assignments.

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
21. `supabase/migrations/20260723123000_fred_pro_mode.sql`
22. `supabase/migrations/20260723170000_quickfred_conversation_agent.sql`
23. `supabase/migrations/20260727182232_user_reasonings.sql`
24. `supabase/migrations/20260727183824_user_reasoning_owner_fk_indexes.sql`
25. `supabase/migrations/20260731110000_telegram_bot_integration.sql`

Supabase Auth must be enabled for email/password login. Authorized accounts are manually provisioned; the app does not expose self-service registration. Server persistence stores the authenticated Supabase `user.id` as `conversations.client_id`, `messages.client_id`, and `agent_runs.client_id`. Fred sessions and messages use separate `fred_*` tables and retain their bridge/webhook provenance. For assistant messages, `content` remains the original provider answer; `display_content`, `research_trace`, `source_references`, and `content_transformation` record the bounded native presentation separately. Deleting an owned conversation cascades to its messages, agent runs, and agent steps; deleting a Fred conversation cascades to its Fred messages and processed webhook events. The admin request audit records only submitted user prompts and is deliberately independent of conversation deletion; deleting the audit history does not remove a user's conversations.

Successful research results are stored separately from the 1,200-character agent-step preview. One additional batched, non-reasoning LLM call can create up to ten compact Memory Cards per run. Opaque MCP text remains a non-authoritative discovery hint and is requeried before legal use; only deterministically typed RIS/EVI evidence with the exact matching Stichtag can become reusable legal memory.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run telegram:typecheck
npm run telegram:build
npm run build
```

## Deployment

Deploy the Next.js application through Coolify. Configure the Supabase variables, `DEEPSEEK_API_KEY` for BFG Suche PRO, `OPENROUTER_API_KEY` for Scanning and image-assisted forms, and the required `WEKNORA_FRED_*` values as protected runtime environment variables. For QuickFred, configure all four `WEKNORA_QUICKFRED_*` values and bind its dedicated channel to the expected agent UUID. Both channel allowlists must include the exact Findog exchange origin and use the same message webhook URL and HMAC secret. Do not expose provider keys as build arguments or `NEXT_PUBLIC_` variables. Restart or redeploy the application after changing a runtime variable. The Coolify reverse proxy must accept request bodies of at least 100 MiB so that a valid maximum Scanning batch, including multipart overhead, reaches the application. BFG Suche PRO plans Findok queries with deepseek-v4-flash and reranks the official candidates with deepseek-v4-pro at maximum reasoning effort, so a single PRO request can take several minutes; the reverse proxy read/response timeout for `/api/findok/bfg/pro` must allow at least 600 seconds. That route streams newline-delimited JSON progress events (query planning, Findok retrieval, sorting, reranking) before the final result, so the reverse proxy must forward the response unbuffered and must not compress or rewrite `application/x-ndjson`.

The native Fred chat mirrors the WeKnora embed capabilities configured for its channel and agent. When enabled upstream, users can request web search and attach up to five images (JPEG, PNG, GIF, or WebP; 10 MB each) plus five documents (`pdf`, `doc`, `docx`, `txt`, `md`, `csv`, `xlsx`, `xls`, `ppt`, or `pptx`; 20 MB each). Files are forwarded to WeKnora for the current request only. Findog stores auditable attachment metadata (name, MIME type, size, SHA-256) and the web-search flag with the user message, but not the binary file or data URI.

### Telegram worker deployment

Deploy Telegram as two processes from the same revision and environment:

```bash
# Web application
npm ci
npm run build
npm run start

# Separate persistent worker
npm ci
npm run telegram:build
node dist/telegram-worker.mjs
```

The Next.js application owns `/api/webhooks/telegram/<webhook-id>` and acknowledges valid updates quickly. The worker claims durable PostgreSQL jobs with per-claim random UUID leases, runs the shared Fred turn service and records every Telegram delivery chunk. Configure `TELEGRAM_CREDENTIALS_KEY`, Supabase service credentials and all Fred/QuickFred variables identically in both services; start with `TELEGRAM_WORKER_CONCURRENCY=2`.

The worker exposes `GET /healthz` and `GET /readyz` only on `TELEGRAM_WORKER_PORT`. Configure Coolify's internal health check against `/healthz`, restart the worker on failure and do **not** assign it a public domain. Only the web application receives public Telegram webhooks.

Bot-token rotation is performed in place from Findog settings. Findog validates and configures the replacement bot first, atomically switches the encrypted credentials while preserving the integration ID and Fred history, clears old bot queue/binding state, and then removes the old webhook and commands. The replacement bot must be paired again. For an emergency disconnect, use the authenticated settings action; it cancels open jobs, calls `deleteWebhook` with `drop_pending_updates=true`, removes commands and only then deletes the encrypted credential row. If required cleanup fails, the integration is retained for a safe retry.

For webhook diagnosis, call Telegram `getWebhookInfo` with the affected user's bot token from a secret-safe administrative shell and compare its URL with `${TELEGRAM_PUBLIC_ORIGIN}/api/webhooks/telegram/<webhook-id>`. Never paste tokens into logs or support tickets. A growing queue with healthy webhooks usually indicates a stopped worker or expired leases; restore the worker first. Leased jobs are reclaimed after their lease expires. Rows marked with uncertain delivery must be inspected rather than blindly replayed, because Telegram may have accepted a message even when the acknowledgement was lost.
