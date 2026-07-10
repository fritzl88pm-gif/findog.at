# findog.at

Next.js MVP for Findog/Fred, a German-language tax-law chat UI using DeepSeek v4 and the fixed BFG/WeKnora MCP endpoint.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, sign in to a manually provisioned Supabase account with a password or Magic Link, and choose between `deepseek-v4-flash` and `deepseek-v4-pro` (the default). Both models use only the server-side DeepSeek key; users do not provide API keys. The selected model and system prompt are stored in browser `localStorage`, and the Settings panel can reset the prompt to the bundled Fred default. Local chat history is scoped by the authenticated Supabase user ID, and conversation IDs are verified server-side before use. BFG/WeKnora MCP access is fixed server-side and is not configurable by users.

Assistant responses include a streaming agent-step panel with the plan, loaded MCP tools, tool calls, bounded tool-result snippets, optional attachment-context extraction status, BFG citation verification, and the final answer marker.

BFG case citations discovered through the fixed WeKnora/MCP knowledge base are verified server-side against the public Findok resolver (`/findok/api/volltext/gz`) before final output. Final answers may only name verified BFG Geschäftszahlen from the `findok-bfg` index, and verified `RV/...`/`RS/...`/`RM/...`/`AW/...`/`VH/...` citations are rendered as links to the official Findok PDF (`dokumentPdfMediaUrl`). Unverified or missing Findok cases are omitted from the final answer rather than linked or shown as plain citations.

## Environment

Copy `.env.example` to `.env.local` and configure Supabase Auth before using the chat.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL for password, Magic Link, and recovery authentication. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anon key for Auth calls. Do not use a service role key here. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL for validating Auth access tokens and chat persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key. Never expose it to the browser. |
| `DEEPSEEK_API_KEY` | Yes | Server-only DeepSeek API key used for the supported v4 Flash/Pro models. Never expose it to the browser. |
| `GLOBAL_DEEPSEEK_API_KEY` | Optional | Fallback server-only DeepSeek key if `DEEPSEEK_API_KEY` is unset or blank. |
| `BFG_MCP_BEARER_TOKEN` | Yes | Server-only bearer token for the fixed BFG/WeKnora MCP endpoint. Never expose it to the browser. |
| `OPENROUTER_API_KEY` | Yes for PDF/image uploads | Server-only OpenRouter key used only for fixed Gemini 3.5 Flash attachment/OCR context extraction. Never expose it to the browser. |

DeepSeek uses the OpenAI-compatible base URL `https://api.deepseek.com` and `POST /chat/completions`. The final-answer LLM is restricted server-side to exactly `deepseek-v4-flash` and `deepseek-v4-pro`, using only the server-side key. Deprecated `deepseek-chat`, `deepseek-reasoner`, arbitrary client model IDs, and client API keys are not accepted.

PDF and image uploads are handled as a separate fixed server-side context layer: the browser sends up to five `application/pdf` attachments and up to five image attachments with the chat payload, the server sends each file to OpenRouter model `google/gemini-3.5-flash` for OCR/document or image extraction, and the extracted Markdown contexts are passed to the selected supported DeepSeek model. The existing 50 MB per-PDF limit still applies; images are capped at 5 MB each. There is no page-count gate before extraction. Gemini does not produce the final chat answer.

## Authentication

Harald provisions authorized accounts manually. Findog has no public registration or account-creation UI; unauthenticated users can sign in with their password or request a Magic Link, and can request a password reset.

For passwordless login, enter the account email and select `Magic Link senden`; no password is required. Supabase returns the link to the normal signed-in Findog app. Magic Link requests explicitly disable automatic user creation, so only manually provisioned accounts can sign in.

For password recovery, enter the account email on the sign-in form and select `Passwort vergessen?`. Supabase sends the recovery email, and its link returns to Findog. The browser opens a dedicated form for setting and confirming the new password, updates the Supabase user, signs out the temporary recovery session, and returns to the standard sign-in form.

The app sends `window.location.origin` as the redirect target for both Magic Link login and password recovery. Every deployed Findog app origin that can initiate either flow must therefore be included in the allowed Redirect URLs under Supabase Auth URL configuration. Add the local origin separately when testing either flow on `http://localhost:3000`.

## Supabase Migration

Apply both migrations in order through the Supabase SQL editor or your migration flow:

1. `supabase/migrations/0001_chat_history.sql`
2. `supabase/migrations/0002_agent_runs.sql`

Supabase Auth must be enabled for email/password and Magic Link login. Authorized accounts are manually provisioned; the app does not expose self-service registration. Server persistence stores the authenticated Supabase `user.id` as `conversations.client_id`, `messages.client_id`, and `agent_runs.client_id`. Deleting an owned conversation cascades to its messages, agent runs, and agent steps.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deployment

Deploy as a standard Vercel Next.js app. Configure the Supabase env vars plus server-only `DEEPSEEK_API_KEY` (or optional fallback `GLOBAL_DEEPSEEK_API_KEY`) and `BFG_MCP_BEARER_TOKEN` in the deployment environment. Add every deployed Findog app origin to the Supabase Auth redirect allow-list so Magic Link and recovery links can return to the originating deployment. Users never provide DeepSeek keys in the authenticated UI.
