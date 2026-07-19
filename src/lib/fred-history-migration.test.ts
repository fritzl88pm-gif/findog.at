import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260719012227_weknora_fred_chat_history.sql",
    import.meta.url,
  )),
  "utf8",
);
const indexMigration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260719012331_fred_chat_history_fk_indexes.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fred chat-history migration", () => {
  it("keeps WeKnora conversations, messages, and signed deliveries separate", () => {
    expect(migration).toMatch(/create table public\.fred_conversations/i);
    expect(migration).toMatch(/create table public\.fred_messages/i);
    expect(migration).toMatch(/create table public\.fred_webhook_events/i);
    expect(migration).toMatch(/unique \(weknora_channel_id, weknora_session_id\)/i);
    expect(migration).toMatch(/raw_event jsonb not null/i);
    expect(migration).toMatch(/signature_verified boolean not null default true check \(signature_verified\)/i);
    expect(migration).toMatch(/fred_messages_has_provenance[\s\S]*bridge_event_id is not null or webhook_event_id is not null/i);
  });

  it("binds every message to the same authenticated conversation owner", () => {
    expect(migration).toMatch(/client_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/foreign key \(conversation_id, client_id\)[\s\S]*references public\.fred_conversations\(id, client_id\)[\s\S]*on delete cascade/i);
    expect(migration).toMatch(/fred_webhook_events_conversation_owner_fk[\s\S]*foreign key \(conversation_id, client_id\)[\s\S]*references public\.fred_conversations\(id, client_id\)/i);
    expect(migration).toMatch(/conversation_row\.client_id is distinct from client_id_value[\s\S]*ownership mismatch/i);
  });

  it("uses RLS and service-role-only table and function access", () => {
    for (const table of ["fred_conversations", "fred_messages", "fred_webhook_events"]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
    expect(migration).toMatch(/revoke all on table[\s\S]*fred_conversations[\s\S]*from anon, authenticated/i);
    expect(migration).toMatch(/create function public\.record_fred_bridge_event\(payload jsonb\)[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/create function public\.record_fred_webhook_event\(payload jsonb\)[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/revoke all on function public\.record_fred_bridge_event\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.record_fred_webhook_event\(jsonb\)[\s\S]*to service_role/i);
  });

  it("serializes session binding and stores unmatched signed webhooks only temporarily", () => {
    expect(migration).toMatch(/pg_advisory_xact_lock[\s\S]*fred:/i);
    expect(migration).toMatch(/processed_at is null[\s\S]*received_at < now\(\) - interval '24 hours'/i);
    expect(migration).toMatch(/if not found then[\s\S]*'pending', true/i);
    expect(migration).toMatch(/delivery_sha256 char\(64\) not null unique/i);
    expect(migration).toMatch(/bridge_event_id uuid unique/i);
  });

  it("covers the Fred ownership foreign keys for cascading deletes", () => {
    expect(indexMigration).toMatch(/fred_messages_client_idx[\s\S]*fred_messages \(client_id\)/i);
    expect(indexMigration).toMatch(/fred_messages_conversation_owner_idx[\s\S]*fred_messages \(conversation_id, client_id\)/i);
    expect(indexMigration).toMatch(/fred_webhook_events_conversation_owner_idx[\s\S]*fred_webhook_events \(conversation_id, client_id\)/i);
  });
});
