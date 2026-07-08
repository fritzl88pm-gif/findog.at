# findog.at

Next.js MVP for Findog/Fred, a German-language tax-law chat UI using DeepSeek BYOK and the fixed BFG/WeKnora MCP endpoint.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, enter a DeepSeek API key in the UI, and optionally enter an MCP bearer token. Secret fields are kept only in React state for the current browser session; model, system prompt, anonymous client ID, and local chat history are stored in browser `localStorage`.

## Environment

Copy `.env.example` to `.env.local` when server-side Supabase persistence is needed.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | No | Enables optional chat persistence with Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Server-only Supabase service role key. Never expose it to the browser. |

DeepSeek keys and MCP bearer tokens are entered by the user in the browser UI and are not configured as server environment variables.

## Supabase Migration

Run `supabase/migrations/0001_chat_history.sql` in the Supabase SQL editor or through your migration flow. The app works without Supabase; when Supabase env vars are missing, chat history remains in browser `localStorage`.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Deployment

Deploy as a standard Vercel Next.js app. Configure Supabase env vars only if server-side persistence is needed. No DeepSeek or MCP secrets belong in Vercel env vars for this MVP.
