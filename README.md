# findog.at

Next.js MVP for Findog/Fred, a German-language tax-law chat UI using DeepSeek BYOK and the fixed BFG/WeKnora MCP endpoint.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, register or sign in with Supabase Auth, enter a DeepSeek API key in the UI, and optionally enter an MCP bearer token. DeepSeek keys and MCP bearer tokens are kept only in React state for the current browser session; model and system prompt are stored in browser `localStorage`. Local chat history is scoped by the authenticated Supabase user ID.

## Environment

Copy `.env.example` to `.env.local` and configure Supabase Auth before using the chat.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL for email/password login and registration. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anon key for Auth calls. Do not use a service role key here. |
| `SUPABASE_URL` | Yes | Server-side Supabase project URL for validating Auth access tokens and chat persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service role key. Never expose it to the browser. |

DeepSeek keys and MCP bearer tokens are entered by the user in the browser UI and are not configured as server environment variables.

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

Deploy as a standard Vercel Next.js app. Configure all Supabase env vars in the deployment environment. No DeepSeek or MCP secrets belong in Vercel env vars for this MVP.
