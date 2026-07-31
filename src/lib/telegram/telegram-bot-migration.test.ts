import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260731110000_telegram_bot_integration.sql",
    import.meta.url,
  )),
  "utf8",
);
const workerEntrypoint = readFileSync(
  fileURLToPath(new URL("../../workers/telegram.ts", import.meta.url)),
  "utf8",
);

describe("telegram_bot_integration migration", () => {
  // --- telegram_integrations -------------------------------------------------
  it("creates the telegram_integrations table with all required columns", () => {
    expect(migration).toMatch(/create table public\.telegram_integrations/i);
    expect(migration).toMatch(/id uuid primary key default gen_random_uuid/i);
    expect(migration).toMatch(/client_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/bot_user_id bigint not null/i);
    expect(migration).toMatch(/encrypted_token text not null/i);
    expect(migration).toMatch(/webhook_id uuid not null default gen_random_uuid/i);
    expect(migration).toMatch(/webhook_secret_sha256 char\(64\) not null/i);
    expect(migration).toMatch(/pairing_token_sha256 char\(64\)/i);
    expect(migration).toMatch(/pairing_expires_at timestamptz/i);
    expect(migration).toMatch(/paired_telegram_user_id bigint/i);
    expect(migration).toMatch(/paired_telegram_chat_id bigint/i);
    expect(migration).toMatch(/status text not null default 'awaiting_pairing'/i);
  });

  it("keeps the persisted Telegram bot username compatible across the table and swap RPC", () => {
    const integrationsTable = migration.match(
      /create table public\.telegram_integrations \(([\s\S]*?)\n\);/i,
    )?.[1] ?? "";
    const swapFunction = migration.match(
      /create function public\.swap_telegram_bot\([\s\S]*?\n\$\$;/i,
    )?.[0] ?? "";

    expect(integrationsTable).toMatch(/bot_username text not null/i);
    expect(integrationsTable).toMatch(
      /check \(bot_username ~ '\^\[A-Za-z\]\[A-Za-z0-9_\]\{1,28\}\[Bb\]\[Oo\]\[Tt\]\$'\)/i,
    );
    expect(swapFunction).toMatch(/bot_username = p_new_bot_username/i);
  });

  it("adds unique constraints on bot_user_id, client_id, and webhook_id", () => {
    expect(migration).toMatch(/unique \(bot_user_id\)/i);
    expect(migration).toMatch(/unique \(client_id\)/i);
    expect(migration).toMatch(/unique \(webhook_id\)/i);
  });

  it("has encrypted_token not empty check", () => {
    expect(migration).toMatch(/char_length\(encrypted_token\)\s*>\s*0/i);
  });

  it("has pairing fields consistency check", () => {
    expect(migration).toMatch(/pairing_token_sha256 is null and pairing_expires_at is null/i);
    expect(migration).toMatch(/pairing_token_sha256 is not null and pairing_expires_at is not null/i);
  });

  it("has paired fields consistency check", () => {
    expect(migration).toMatch(/paired_telegram_user_id is null and paired_telegram_chat_id is null/i);
    expect(migration).toMatch(/paired_telegram_user_id is not null and paired_telegram_chat_id is not null/i);
  });

  it("has sanitized error fields for last error tracking", () => {
    expect(migration).toMatch(/last_error_code integer/i);
    expect(migration).toMatch(/last_error_description text/i);
    expect(migration).toMatch(/last_error_retry_after integer/i);
    expect(migration).toMatch(/last_error_at timestamptz/i);
  });

  // --- telegram_chat_bindings -------------------------------------------------
  it("creates the telegram_chat_bindings table with nullable active_conversation_id", () => {
    expect(migration).toMatch(/create table public\.telegram_chat_bindings/i);
    expect(migration).toMatch(/integration_id uuid not null/i);
    expect(migration).toMatch(/references public\.telegram_integrations\(id\) on delete cascade/i);
    expect(migration).toMatch(/telegram_chat_id bigint not null/i);
    expect(migration).toMatch(/active_conversation_id uuid null/i);
    expect(migration).toMatch(/references public\.fred_conversations\(id\) on delete set null/i);
  });

  it("has unique constraint on (integration_id, telegram_chat_id) and no longer on fred_conversation_id", () => {
    expect(migration).toMatch(/unique \(integration_id, telegram_chat_id\)/i);
    expect(migration).not.toMatch(/unique \(fred_conversation_id\)/i);
  });

  // --- telegram_updates --------------------------------------------------------
  it("creates the telegram_updates table with queue columns", () => {
    expect(migration).toMatch(/create table public\.telegram_updates/i);
    expect(migration).toMatch(/integration_id uuid not null/i);
    expect(migration).toMatch(/update_id bigint not null/i);
    expect(migration).toMatch(/raw_update jsonb not null/i);
    expect(migration).toMatch(/jsonb_typeof\(raw_update\) = 'object'/i);
    expect(migration).toMatch(/status text not null default 'pending'/i);
    expect(migration).toMatch(/in \('pending', 'processing', 'completed', 'retry', 'failed', 'cancelled'\)/i);
    expect(migration).toMatch(/lease_id uuid/i);
    expect(migration).toMatch(/lease_expires_at timestamptz/i);
    expect(migration).toMatch(/attempt_count integer not null default 0/i);
    expect(migration).toMatch(/max_attempts integer not null default 5/i);
    expect(migration).toMatch(/available_at timestamptz not null default now\(\)/i);
    expect(migration).toMatch(/cancel_requested boolean not null default false/i);
    expect(migration).toMatch(/last_error_code varchar\(64\)/i);
    expect(migration).toMatch(/cancelled_at timestamptz/i);
  });

  it("has unique (integration_id, update_id) on telegram_updates", () => {
    expect(migration).toMatch(/unique \(integration_id, update_id\)/i);
  });

  it("clears raw_update at terminal states", () => {
    expect(migration).toMatch(/in \('pending', 'processing', 'retry'\)/i);
    expect(migration).toMatch(/raw_update = '\{\}'::jsonb/i);
  });

  it("adds telegram_chat_id, telegram_message_id and update_kind to telegram_updates", () => {
    expect(migration).toMatch(/telegram_chat_id bigint not null/i);
    expect(migration).toMatch(/telegram_message_id bigint/i);
    expect(migration).toMatch(/update_kind text not null default 'message'/i);
    expect(migration).toMatch(/in \('message', 'command', 'my_chat_member', 'other'\)/i);
  });

  it("indexes processing updates per integration+chat for cancellation lookups", () => {
    expect(migration).toMatch(/create index telegram_updates_chat_processing_idx/i);
    expect(migration).toMatch(/on public\.telegram_updates \(integration_id, telegram_chat_id\)/i);
  });

  // --- telegram_deliveries -----------------------------------------------------
  it("creates the telegram_deliveries table", () => {
    expect(migration).toMatch(/create table public\.telegram_deliveries/i);
    expect(migration).toMatch(/update_id bigint not null/i);
    expect(migration).toMatch(/chunk_index integer not null default 0/i);
    expect(migration).toMatch(/message_content text not null/i);
    expect(migration).toMatch(/telegram_message_id bigint/i);
    expect(migration).toMatch(/char_length\(message_content\) between 0 and 500000/i);
    expect(migration).toMatch(/status text not null default 'pending'/i);
    expect(migration).toMatch(/in \('pending', 'sent', 'uncertain', 'failed'\)/i);
    expect(migration).toMatch(/last_error_code varchar\(64\)/i);
  });

  it("has unique (update_id, chunk_index) on telegram_deliveries", () => {
    expect(migration).toMatch(/unique \(update_id, chunk_index\)/i);
  });

  // --- fred_conversations alteration ------------------------------------------
  it("alters fred_conversations with origin column and telegram_integration_id", () => {
    expect(migration).toMatch(/alter table public\.fred_conversations/i);
    expect(migration).toMatch(/add column origin text not null default 'web'/i);
    expect(migration).toMatch(/check \(origin in \('web', 'telegram'\)\)/i);
    expect(migration).toMatch(/add column telegram_integration_id uuid/i);
    expect(migration).toMatch(/references public\.telegram_integrations\(id\) on delete set null/i);
  });

  it("does NOT add a constraint that would break origin='telegram' after integration deletion", () => {
    // ON DELETE SET NULL allows telegram_integration_id to be null while origin='telegram'
    // No NOT NULL constraint on telegram_integration_id when origin='telegram'
    expect(migration).not.toMatch(/origin\s*=\s*'telegram'\s*and\s*telegram_integration_id\s+is\s+not\s+null/i);
  });

  // --- RLS --------------------------------------------------------------------
  it("enables RLS on all four new tables", () => {
    expect(migration).toMatch(/alter table public\.telegram_integrations enable row level security/i);
    expect(migration).toMatch(/alter table public\.telegram_chat_bindings enable row level security/i);
    expect(migration).toMatch(/alter table public\.telegram_updates enable row level security/i);
    expect(migration).toMatch(/alter table public\.telegram_deliveries enable row level security/i);
  });

  it("revokes access from public, anon, authenticated on all tables", () => {
    expect(migration).toMatch(/revoke all on table[\s\S]*telegram_integrations[\s\S]*telegram_chat_bindings[\s\S]*telegram_updates[\s\S]*telegram_deliveries[\s\S]*from public, anon, authenticated/i);
  });

  it("grants select, insert, update, delete to service_role on all tables", () => {
    expect(migration).toMatch(/grant select, insert, update, delete on table[\s\S]*telegram_integrations[\s\S]*telegram_chat_bindings[\s\S]*telegram_updates[\s\S]*telegram_deliveries[\s\S]*to service_role/i);
  });

  // --- RPC functions ----------------------------------------------------------
  it("creates pair_telegram_integration for atomic pairing", () => {
    expect(migration).toMatch(/create function public\.pair_telegram_integration/i);
    expect(migration).toMatch(/p_integration_id uuid/i);
    expect(migration).toMatch(/p_pairing_hash char\(64\)/i);
    expect(migration).toMatch(/status = 'awaiting_pairing'/i);
    expect(migration).toMatch(/pairing_token_sha256 = p_pairing_hash/i);
    expect(migration).toMatch(/pairing_expires_at > now\(\)/i);
    expect(migration).toMatch(/returns boolean/i);
    expect(migration).toMatch(/revoke all on function public\.pair_telegram_integration/i);
    expect(migration).toMatch(/grant execute on function public\.pair_telegram_integration/i);
  });

  it("atomically caps queued message work per tenant and chat while exempting commands", () => {
    const enqueue = migration.match(
      /create function public\.enqueue_telegram_update\([\s\S]*?\n\$\$;/i,
    )?.[0] ?? "";
    const lockAt = enqueue.indexOf("pg_catalog.pg_advisory_xact_lock");
    const countAt = enqueue.indexOf("select count(*)");
    const insertAt = enqueue.indexOf("insert into public.telegram_updates");

    expect(enqueue).toMatch(/if p_update_kind = 'message' then/i);
    expect(lockAt).toBeGreaterThan(0);
    expect(lockAt).toBeLessThan(countAt);
    expect(countAt).toBeLessThan(insertAt);
    expect(enqueue).toMatch(/where integration_id = p_integration_id[\s\S]*telegram_chat_id = p_telegram_chat_id[\s\S]*update_kind = 'message'[\s\S]*status in \('pending', 'processing', 'retry'\)/i);
    expect(enqueue).toMatch(/if v_queued_question_count >= 5 then[\s\S]*'status', 'busy'/i);
  });

  it("creates claim_pending_telegram_updates with SKIP LOCKED and retry/reclaim", () => {
    expect(migration).toMatch(/create function public\.claim_pending_telegram_updates/i);
    expect(migration).toMatch(/for update(?: of u)? skip locked/i);
    expect(migration).toMatch(/set status = 'processing'/i);
    expect(migration).toMatch(/status in \('pending', 'retry'\)/i);
    expect(migration).toMatch(/available_at <= now\(\)/i);
    expect(migration).toMatch(/cancel_requested = false/i);
    expect(migration).toMatch(/lease_expires_at <= now\(\)/i);
  });

  it("claims globally across integrations (no p_integration_id parameter)", () => {
    const fnMatch = migration.match(
      /create function public\.claim_pending_telegram_updates\(([\s\S]*?)\)\s*\n?returns/i,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[1]).not.toMatch(/p_integration_id/i);
  });

  it("lets only a valid /stop bypass a busy chat and prioritizes it", () => {
    const claim = migration.match(
      /create function public\.claim_pending_telegram_updates\([\s\S]*?\n\$\$;/i,
    )?.[0] ?? "";

    expect(claim).toMatch(/distinct on \(t\.integration_id, t\.telegram_chat_id\)/i);
    expect(claim).toMatch(/t\.update_kind = 'command'[\s\S]*raw_update\s*#>>\s*'\{message,text\}'[\s\S]*\^\/stop/i);
    expect(claim).toMatch(/or not exists[\s\S]*busy\.status = 'processing'/i);
    expect(claim).toMatch(/is_stop desc[\s\S]*t\.created_at/i);
    expect(claim).not.toMatch(/\^\/new/i);
  });

  it("creates request_cancel_telegram_update_for_chat that sets cancel_requested for the other in-flight job", () => {
    expect(migration).toMatch(/create function public\.request_cancel_telegram_update_for_chat/i);
    expect(migration).toMatch(/p_exclude_update_id/i);
    expect(migration).toMatch(/cancel_requested = true/i);
    expect(migration).toMatch(/and status = 'processing'/i);
  });

  it("creates check_telegram_update_cancelled as a read-only poll", () => {
    expect(migration).toMatch(/create function public\.check_telegram_update_cancelled/i);
    expect(migration).toMatch(/select cancel_requested/i);
  });

  it("creates heartbeat_telegram_update", () => {
    expect(migration).toMatch(/create function public\.heartbeat_telegram_update/i);
    expect(migration).toMatch(/lease_id = p_lease_id/i);
  });

  it("creates complete_telegram_update that clears raw_update", () => {
    expect(migration).toMatch(/create function public\.complete_telegram_update/i);
    expect(migration).toMatch(/raw_update = '\{\}'::jsonb/i);
    expect(migration).toMatch(/status = 'completed'/i);
  });

  it("creates retry_telegram_update with bounded delay and available_at", () => {
    expect(migration).toMatch(/create function public\.retry_telegram_update/i);
    expect(migration).toMatch(/status = 'retry'/i);
    expect(migration).toMatch(/available_at = now/i);
    expect(migration).toMatch(/p_retry_delay_seconds/i);
    expect(migration).toMatch(/p_last_error_code/i);
  });

  it("creates cancel_telegram_update that clears raw_update", () => {
    expect(migration).toMatch(/create function public\.cancel_telegram_update/i);
    expect(migration).toMatch(/status = 'cancelled'/i);
    expect(migration).toMatch(/raw_update = '\{\}'::jsonb/i);
  });

  it("creates cancel_all_telegram_updates_for_integration", () => {
    expect(migration).toMatch(/create function public\.cancel_all_telegram_updates_for_integration/i);
    expect(migration).toMatch(/status in \('pending', 'processing', 'retry'\)/i);
  });

  it("creates fail_telegram_update that clears raw_update", () => {
    expect(migration).toMatch(/create function public\.fail_telegram_update/i);
    expect(migration).toMatch(/status = 'failed'/i);
    expect(migration).toMatch(/raw_update = '\{\}'::jsonb/i);
    expect(migration).toMatch(/p_last_error_code/i);
  });

  it("scrubs retained delivery content whenever queue work becomes terminal", () => {
    for (const functionName of [
      "complete_telegram_update",
      "cancel_telegram_update",
      "cancel_all_telegram_updates_for_integration",
      "fail_telegram_update",
    ]) {
      const definition = migration.match(
        new RegExp(`create function public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`, "i"),
      )?.[0] ?? "";
      expect(definition, functionName).toMatch(
        /update public\.telegram_deliveries[\s\S]*set message_content = ''/i,
      );
    }
  });

  it("atomically clears active bindings and deletes only owner-scoped Fred conversations", () => {
    expect(migration).toMatch(/create function public\.delete_owned_fred_conversations/i);
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path = ''/i);
    expect(migration).toMatch(/where conversation\.client_id = p_client_id[\s\S]*conversation\.id = any\(p_conversation_ids\)/i);
    expect(migration).toMatch(/update public\.telegram_chat_bindings[\s\S]*set active_conversation_id = null/i);
    expect(migration).toMatch(/delete from public\.fred_conversations[\s\S]*client_id = p_client_id/i);
    expect(migration).toMatch(/returns table \(id uuid\)/i);
  });

  it("restricts the owner-scoped deletion RPC to service_role", () => {
    expect(migration).toMatch(
      /revoke all on function public\.delete_owned_fred_conversations\(uuid, uuid\[\]\)[\s\S]*from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.delete_owned_fred_conversations\(uuid, uuid\[\]\)[\s\S]*to service_role/i,
    );
  });

  it("atomically swaps a bot only after locking the expected owner row", () => {
    const swap = migration.match(
      /create function public\.swap_telegram_bot\([\s\S]*?\n\$\$;/i,
    )?.[0] ?? "";
    expect(swap).toContain("security definer");
    expect(swap).toContain("set search_path = ''");
    expect(swap).toMatch(/where id = p_integration_id[\s\S]*client_id = p_client_id[\s\S]*bot_user_id = p_old_bot_user_id[\s\S]*for update/i);
    expect(swap.indexOf("for update")).toBeLessThan(swap.indexOf("delete from public.telegram_updates"));
    expect(swap).toMatch(/delete from public\.telegram_chat_bindings[\s\S]*where integration_id = p_integration_id/i);
    expect(swap).toMatch(/delete from public\.telegram_updates[\s\S]*where integration_id = p_integration_id/i);
    expect(swap).toMatch(/update public\.telegram_integrations[\s\S]*paired_telegram_user_id = null[\s\S]*status = 'awaiting_pairing'/i);
  });

  it("restricts bot replacement and cleanup-warning RPCs to service_role", () => {
    expect(migration).toMatch(/revoke all on function public\.swap_telegram_bot\([\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.swap_telegram_bot\([\s\S]*to service_role/i);
    expect(migration).toMatch(/revoke all on function public\.record_telegram_integration_warning\(uuid, text\)[\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.record_telegram_integration_warning\(uuid, text\)[\s\S]*to service_role/i);
  });

  it("all invoker RPC functions use a safe search_path", () => {
    const functions = migration.match(/create (?:or replace )?function public\.\w+/gi) ?? [];
    expect(functions.length).toBeGreaterThanOrEqual(9);
    const withSecurityInvoker = (migration.match(/security invoker/gi) ?? []).length;
    const withSearchPath = (migration.match(/set search_path = ''/gi) ?? []).length;
    expect(withSearchPath).toBeGreaterThanOrEqual(withSecurityInvoker);
    expect(withSearchPath).toBeGreaterThanOrEqual(9);
  });

  it("all RPC functions have revoke + grant to service_role", () => {
    const revokeCount = (migration.match(/revoke all on function public\./gi) ?? []).length;
    const grantCount = (migration.match(/grant execute on function public\./gi) ?? []).length;
    expect(revokeCount).toBeGreaterThanOrEqual(9);
    expect(grantCount).toBe(revokeCount);
  });

  it("keeps every buildRpc function name in parity with the migration", () => {
    const buildRpc = workerEntrypoint.match(
      /export function buildRpc\([\s\S]*?\n}\n/i,
    )?.[0] ?? "";
    const runtimeNames = [...buildRpc.matchAll(/invokeRpc\(supabase, "([a-z0-9_]+)"/g)]
      .map((match) => match[1]);
    const migrationNames = new Set(
      [...migration.matchAll(/create function public\.([a-z0-9_]+)\(/gi)]
        .map((match) => match[1]),
    );

    expect(runtimeNames.length).toBeGreaterThan(0);
    expect(runtimeNames.filter((name) => !migrationNames.has(name))).toEqual([]);
  });

  it("contains no standalone UPDATE/DELETE outside functions that would backfill data", () => {
    const outsideFunctions = migration.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(outsideFunctions).not.toMatch(/update public\.fred_conversations/i);
    expect(outsideFunctions).not.toMatch(/delete from public\.fred_conversations/i);
  });
});
