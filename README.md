# findog.at

Next.js MVP for Findog/Fred, a German-language tax-law chat UI using DeepSeek v4 and the fixed BFG/WeKnora MCP endpoint.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, register or sign in with Supabase Auth, and use the default `deepseek-v4-flash` model through the server-side global DeepSeek key. `deepseek-v4-pro` is optional BYOK: users enter their own DeepSeek API key in Settings, and that key is kept only in React state for the current browser session. Model and system prompt are stored in browser `localStorage`; the Settings panel can reset the prompt to the bundled Fred default. Local chat history is scoped by the authenticated Supabase user ID, and conversation IDs are verified server-side before use. BFG/WeKnora MCP access is fixed server-side and is not configurable by users.

Assistant responses include a non-streaming agent-step panel with the plan, loaded MCP tools, tool calls, bounded tool-result snippets, and the final answer marker.

## Environment

Copy `.env.example` to `.env.local` and configure Supabase Auth before using the chat.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL for email/password login and registration. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anon key for Auth calls. Do not use a service role key here. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL for validating Auth access tokens and chat persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key. Never expose it to the browser. |
| `DEEPSEEK_API_KEY` | Yes | Server-only DeepSeek API key used for the default `deepseek-v4-flash` model. Never expose it to the browser. |
| `GLOBAL_DEEPSEEK_API_KEY` | Optional | Fallback server-only DeepSeek Flash key if `DEEPSEEK_API_KEY` is unset or blank. |
| `BFG_MCP_BEARER_TOKEN` | Yes | Server-only bearer token for the fixed BFG/WeKnora MCP endpoint. Never expose it to the browser. |

DeepSeek uses the OpenAI-compatible base URL `https://api.deepseek.com` and `POST /chat/completions`. Supported models are `deepseek-v4-flash` and `deepseek-v4-pro`. Deprecated `deepseek-chat` and `deepseek-reasoner` must not be used.

`deepseek-v4-flash` is the default for authenticated users and always uses the server-only global key. The browser does not send a user DeepSeek key for Flash. `deepseek-v4-pro` requires the user's own DeepSeek API key in Settings; that key remains browser-session only and is not persisted.

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

Deploy as a standard Vercel Next.js app. Configure the Supabase env vars plus server-only `DEEPSEEK_API_KEY` (or optional fallback `GLOBAL_DEEPSEEK_API_KEY`) and `BFG_MCP_BEARER_TOKEN` in the deployment environment. Users bring their own DeepSeek key only when selecting `deepseek-v4-pro` in the authenticated UI.
