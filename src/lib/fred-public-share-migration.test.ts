import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260730150000_fred_public_answer_shares.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("fred_public_answer_shares migration", () => {
  it("creates the fred_public_answer_shares table with all required columns", () => {
    expect(migration).toMatch(/create table public\.fred_public_answer_shares/i);
    expect(migration).toMatch(/id uuid primary key default gen_random_uuid/i);
    expect(migration).toMatch(/conversation_id uuid not null/i);
    expect(migration).toMatch(/client_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/question_message_id bigint not null references public\.fred_messages\(id\) on delete cascade/i);
    expect(migration).toMatch(/assistant_message_id bigint not null references public\.fred_messages\(id\) on delete cascade/i);
    expect(migration).toMatch(/question_content text not null/i);
    expect(migration).toMatch(/answer_content text not null/i);
    expect(migration).toMatch(/created_at timestamptz not null default now/i);
  });

  it("adds content length check constraint (1-500000)", () => {
    expect(migration).toMatch(/char_length\(question_content\) between 1 and 500000/i);
    expect(migration).toMatch(/char_length\(answer_content\) between 1 and 500000/i);
  });

  it("adds composite FK to fred_conversations with cascade delete", () => {
    expect(migration).toMatch(/foreign key \(conversation_id, client_id\)/i);
    expect(migration).toMatch(/references public\.fred_conversations\(id, client_id\)/i);
    expect(migration).toMatch(/on delete cascade/i);
  });

  it("adds unique constraint on (client_id, assistant_message_id)", () => {
    expect(migration).toMatch(/unique \(client_id, assistant_message_id\)/i);
  });

  it("adds check that question_message_id <> assistant_message_id", () => {
    expect(migration).toMatch(/question_message_id\s*<>\s*assistant_message_id/i);
  });

  it("enables RLS and revokes access from public, anon, authenticated", () => {
    expect(migration).toMatch(/alter table public\.fred_public_answer_shares enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.fred_public_answer_shares from public, anon, authenticated/i);
  });

  it("grants only select, insert to service_role", () => {
    expect(migration).toMatch(/grant select, insert on public\.fred_public_answer_shares to service_role/i);
  });

  it("replaces record_fred_native_event and includes message_id in return JSON", () => {
    expect(migration).toMatch(/create or replace function public\.record_fred_native_event\(payload jsonb\)/i);
    expect(migration).toMatch(/message_id_value/i);
    expect(migration).toMatch(/result_value \|\| jsonb_build_object\('message_id', message_id_value\)/i);
  });

  it("creates create_fred_public_answer_share RPC with service-role-only access", () => {
    expect(migration).toMatch(/create function public\.create_fred_public_answer_share\(payload jsonb\)/i);
    expect(migration).toMatch(/security invoker/i);
    expect(migration).toMatch(/set search_path = ''/i);
    expect(migration).toMatch(/returns jsonb/i);
  });

  it("create_fred_public_answer_share validates client_id, conversation_id, and positive assistant_message_id", () => {
    expect(migration).toMatch(/assistant_message_id_value <= 0/i);
    expect(migration).toMatch(/fred public share fields are invalid/i);
  });

  it("create_fred_public_answer_share locks conversation row with FOR KEY SHARE and verifies ownership", () => {
    expect(migration).toMatch(/from public\.fred_conversations[\s\S]*where id = conversation_id_value[\s\S]*and client_id = client_id_value[\s\S]*for key share/i);
    expect(migration).toMatch(/fred public share conversation not found/i);
  });

  it("create_fred_public_answer_share validates assistant role", () => {
    expect(migration).toMatch(/assistant_row\.role\s*<>\s*'assistant'/i);
    expect(migration).toMatch(/not an assistant message/i);
  });

  it("create_fred_public_answer_share resolves nearest preceding user message with exact chronology including NULL timestamps", () => {
    // Must handle both non-NULL and NULL assistant provider_created_at branches
    expect(migration).toMatch(/assistant_row\.provider_created_at is not null/i);
    expect(migration).toMatch(/assistant_row\.provider_created_at is null/i);
    // Order must be DESC NULLS FIRST, then id desc
    expect(migration).toMatch(/order by provider_created_at desc nulls first, id desc/i);
    // For NULL assistant, any non-NULL user timestamp qualifies, or NULL with lower id
    expect(migration).toMatch(/provider_created_at is not null[\s\S]*provider_created_at is null[\s\S]*id < assistant_row\.id/);
  });

  it("create_fred_public_answer_share snapshots display_content or falls back to content", () => {
    expect(migration).toMatch(/coalesce\(nullif\(assistant_row\.display_content,\s*''\),\s*assistant_row\.content\)/i);
  });

  it("create_fred_public_answer_share uses ON CONFLICT DO NOTHING for concurrency-safe idempotent insert", () => {
    expect(migration).toMatch(/on conflict \(client_id, assistant_message_id\) do nothing/i);
    expect(migration).toMatch(/returning id into existing_share_id/i);
  });

  it("create_fred_public_answer_share falls back to select existing id when ON CONFLICT DO NOTHING returns no row", () => {
    expect(migration).toMatch(/if not found then/i);
    expect(migration).toMatch(/select id[\s\S]*from public\.fred_public_answer_shares[\s\S]*where client_id = client_id_value[\s\S]*and assistant_message_id = assistant_message_id_value/i);
  });

  it("create_fred_public_answer_share returns only share_id via jsonb_build_object", () => {
    expect(migration).toMatch(/jsonb_build_object\('share_id',/i);
  });

  it("revokes and grants create_fred_public_answer_share to service_role only", () => {
    expect(migration).toMatch(/revoke all on function public\.create_fred_public_answer_share\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.create_fred_public_answer_share\(jsonb\)[\s\S]*to service_role/i);
  });

  it("contains no standalone UPDATE/DELETE that would backfill/rewrite existing table data", () => {
    const outsideFunctions = migration.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(outsideFunctions).not.toMatch(/update public\.fred_messages/i);
    expect(outsideFunctions).not.toMatch(/delete from public\.fred_messages/i);
    expect(outsideFunctions).not.toMatch(/update public\.fred_conversations/i);
  });

  it("does not use preselect-then-insert anti-pattern; uses ON CONFLICT DO NOTHING instead", () => {
    // The old pattern was: SELECT existing -> if found return -> INSERT
    // Must not contain a preselect that returns existing_share_id before INSERT
    const createFunction = migration.split("create function public.create_fred_public_answer_share")[1] ?? "";
    // The ON CONFLICT must appear before any "return jsonb_build_object('share_id', existing_share_id)"
    const conflictIndex = createFunction.indexOf("on conflict");
    const returnBeforeConflict = /return jsonb_build_object\('share_id', existing_share_id\)/i;
    const returnBeforeConflictMatch = createFunction.slice(0, conflictIndex).match(returnBeforeConflict);
    expect(returnBeforeConflictMatch).toBeNull();
  });
});
