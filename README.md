# findog.at

Next.js MVP for Findog/Fred, a German-language tax-law chat UI using DeepSeek v4 and the fixed BFG/WeKnora MCP endpoint.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, register or sign in with Supabase Auth, and use the fixed `deepseek-v4-pro` model through the server-side DeepSeek key. Users do not choose a model and do not provide DeepSeek API keys. The system prompt is stored in browser `localStorage`; the Settings panel can reset the prompt to the bundled Fred default. Local chat history is scoped by the authenticated Supabase user ID, and conversation IDs are verified server-side before use. BFG/WeKnora MCP access is fixed server-side and is not configurable by users.

Assistant responses include a streaming agent-step panel with the plan, loaded MCP tools, tool calls, bounded tool-result snippets, optional attachment-context extraction status, and the final answer marker.

## Environment

Copy `.env.example` to `.env.local` and configure Supabase Auth before using the chat.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL for email/password login and registration. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anon key for Auth calls. Do not use a service role key here. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL for validating Auth access tokens and chat persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key. Never expose it to the browser. |
| `DEEPSEEK_API_KEY` | Yes | Server-only DeepSeek API key used for the fixed `deepseek-v4-pro` model. Never expose it to the browser. |
| `GLOBAL_DEEPSEEK_API_KEY` | Optional | Fallback server-only DeepSeek key if `DEEPSEEK_API_KEY` is unset or blank. |
| `BFG_MCP_BEARER_TOKEN` | Yes | Server-only bearer token for the fixed BFG/WeKnora MCP endpoint. Never expose it to the browser. |
| `OPENROUTER_API_KEY` | Yes for PDF/image uploads | Server-only OpenRouter key used only for fixed Gemini 3.5 Flash attachment/OCR context extraction. Never expose it to the browser. |

DeepSeek uses the OpenAI-compatible base URL `https://api.deepseek.com` and `POST /chat/completions`. The final-answer LLM is fixed to `deepseek-v4-pro`, using only the server-side key. Deprecated `deepseek-chat` and `deepseek-reasoner` must not be used.

PDF and image uploads are handled as a separate fixed server-side context layer: the browser sends up to five `application/pdf` attachments and up to five image attachments with the chat payload, the server sends each file to OpenRouter model `google/gemini-3.5-flash` for OCR/document or image extraction, and the extracted Markdown contexts are passed together into `deepseek-v4-pro`. The existing 50 MB per-PDF limit still applies; images are capped at 5 MB each. There is no page-count gate before extraction. Gemini does not produce the final chat answer.

## Supabase Migration

Run `supabase/migrations/0001_chat_history.sql` in the Supabase SQL editor or through your migration flow. Supabase Auth must be enabled for email/password users. Server persistence stores the authenticated Supabase `user.id` as `conversations.client_id` and `messages.client_id`.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deployment

Deploy as a standard Vercel Next.js app. Configure the Supabase env vars plus server-only `DEEPSEEK_API_KEY` (or optional fallback `GLOBAL_DEEPSEEK_API_KEY`) and `BFG_MCP_BEARER_TOKEN` in the deployment environment. Users never provide DeepSeek keys in the authenticated UI.
