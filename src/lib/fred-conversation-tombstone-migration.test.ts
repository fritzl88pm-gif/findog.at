import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260830170000_tombstone_deleted_fred_conversations.sql",
  import.meta.url,
)), "utf8");

function requiredMatch(pattern: RegExp, label: string): RegExpMatchArray {
  const match = migration.match(pattern);
  expect(match, `${label} must exist`).not.toBeNull();
  return match!;
}

function functionBody(name: string): string {
  return requiredMatch(
    new RegExp(
      `create(?: or replace)? function public\\.${name}\\([^)]*\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
      "i",
    ),
    `${name} function`,
  )[1];
}

describe("deleted Fred conversation tombstone migration", () => {
  it("stores an immutable content-free session hash behind RLS and least privilege", () => {
    const table = requiredMatch(
      /create table public\.fred_conversation_tombstones \(([\s\S]*?)\n\);/i,
      "tombstone table",
    )[1];

    expect(table).toMatch(/conversation_id uuid primary key/i);
    expect(table).toMatch(/client_id uuid not null/i);
    expect(table).not.toMatch(/references auth\.users|on delete cascade/i);
    expect(table).toMatch(/session_key_sha256 char\(64\) not null unique/i);
    expect(table).toMatch(/deleted_at timestamptz not null/i);
    expect(table).toMatch(/deletion_reason text not null/i);
    expect(table).not.toMatch(/weknora_(?:channel|session)_id|title|content|raw_event/i);

    expect(migration).toMatch(
      /alter table public\.fred_conversation_tombstones enable row level security/i,
    );
    expect(migration).toMatch(
      /revoke all on public\.fred_conversation_tombstones\s+from public, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /grant select on public\.fred_conversation_tombstones\s+to service_role/i,
    );
    expect(migration).not.toMatch(
      /grant[^;]*(?:insert|update|delete)[^;]*fred_conversation_tombstones/i,
    );
    expect(migration).toMatch(
      /create trigger fred_conversation_tombstones_immutable\s+before update or delete on public\.fred_conversation_tombstones/i,
    );

    const hashBody = functionBody("fred_conversation_session_sha256");
    expect(hashBody).toContain("findog:fred-conversation-session:v1|");
    expect(hashBody).toMatch(/extensions\.digest[\s\S]*'sha256'/i);
  });

  it("guards inserts and makes provider-session provenance immutable", () => {
    const guard = functionBody("guard_deleted_fred_conversation_session");

    expect(migration).toMatch(
      /before insert on public\.fred_conversations[\s\S]*guard_deleted_fred_conversation_session\(\)/i,
    );
    expect(migration).toMatch(
      /before update of weknora_channel_id, weknora_session_id\s+on public\.fred_conversations[\s\S]*guard_deleted_fred_conversation_session\(\)/i,
    );
    expect(guard).toMatch(/tg_op = 'UPDATE'[\s\S]*provider session is immutable/i);
    expect(guard).toMatch(
      /lock_existing_findog_account\(new\.client_id\)[\s\S]*fred conversation client does not exist/i,
    );
    expect(guard.indexOf("lock_existing_findog_account")).toBeLessThan(
      guard.indexOf("perform pg_advisory_xact_lock"),
    );
    expect(guard).toMatch(
      /pg_advisory_xact_lock\([\s\S]*hashtextextended\([\s\S]*'fred:'\s*\|\|\s*new\.weknora_channel_id\s*\|\|\s*':'\s*\|\|\s*new\.weknora_session_id/i,
    );
    expect(guard).toMatch(
      /from public\.fred_conversation_tombstones[\s\S]*fred_conversation_session_sha256/i,
    );
    expect(guard).toMatch(/provider session was deleted[\s\S]*errcode = '55000'/i);
  });

  it("discards late webhook content under the session lock before any insert", () => {
    const webhook = functionBody("record_fred_webhook_event");
    const lockIndex = webhook.indexOf("perform pg_advisory_xact_lock");
    const tombstoneIndex = webhook.indexOf("from public.fred_conversation_tombstones");
    const insertIndex = webhook.indexOf("insert into public.fred_webhook_events");

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(tombstoneIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(tombstoneIndex);
    expect(webhook).toMatch(
      /'pending', false,[\s\S]*'discarded', true/i,
    );
    expect(webhook).toMatch(
      /hashtextextended\('fred:' \|\| channel_id_value \|\| ':' \|\| session_id_value, 0\)/i,
    );
    expect(webhook).toMatch(
      /select conversation\.client_id[\s\S]*lock_existing_findog_account\(client_id_value\)/i,
    );
    expect(webhook.indexOf("lock_existing_findog_account")).toBeLessThan(lockIndex);
    expect(webhook).toMatch(
      /if not account_lock_acquired and exists[\s\S]*fred webhook owner discovered after session lock[\s\S]*errcode = '40001'/i,
    );
  });

  it("fences bridge persistence on the account row before the provider session", () => {
    const bridge = functionBody("record_fred_bridge_event");
    const accountLockIndex = bridge.indexOf("lock_existing_findog_account");
    const sessionLockIndex = bridge.indexOf("perform pg_advisory_xact_lock");

    expect(accountLockIndex).toBeGreaterThanOrEqual(0);
    expect(bridge).toMatch(
      /lock_existing_findog_account\(client_id_value\)[\s\S]*fred bridge client does not exist/i,
    );
    expect(sessionLockIndex).toBeGreaterThan(accountLockIndex);
  });

  it("takes every ordered session advisory lock before conversation row locks", () => {
    const deletion = functionBody("delete_owned_fred_conversations");
    const lockLoopIndex = deletion.indexOf("for session_row in");
    const advisoryIndex = deletion.indexOf("perform pg_advisory_xact_lock", lockLoopIndex);
    const rowLockIndex = deletion.indexOf("for update;", advisoryIndex);

    expect(lockLoopIndex).toBeGreaterThanOrEqual(0);
    expect(advisoryIndex).toBeGreaterThan(lockLoopIndex);
    expect(rowLockIndex).toBeGreaterThan(advisoryIndex);
    expect(deletion).toMatch(/order by lock_key, conversation\.id/i);
    expect(deletion).toMatch(
      /lock_existing_findog_account\(p_client_id\)[\s\S]*fred conversation owner does not exist/i,
    );
    expect(deletion.indexOf("lock_existing_findog_account")).toBeLessThan(lockLoopIndex);
    expect(deletion).toMatch(
      /hashtextextended\([\s\S]*'fred:' \|\| conversation\.weknora_channel_id \|\| ':' \|\| conversation\.weknora_session_id,[\s\S]*0[\s\S]*\) as lock_key/i,
    );

    const tombstoneInsert = deletion.indexOf("insert into public.fred_conversation_tombstones");
    const conversationDelete = deletion.indexOf("delete from public.fred_conversations");
    expect(tombstoneInsert).toBeGreaterThan(rowLockIndex);
    expect(conversationDelete).toBeGreaterThan(tombstoneInsert);
  });

  it("atomically cancels active work, redacts content, detaches provenance, and deletes", () => {
    const deletion = functionBody("delete_owned_fred_conversations");

    expect(deletion).toMatch(
      /update public\.telegram_updates[\s\S]*status = 'cancelled',[\s\S]*cancel_requested = true,[\s\S]*raw_update = '\{\}'::jsonb[\s\S]*status in \('pending', 'retry', 'processing'\)/i,
    );
    expect(deletion).toMatch(
      /update public\.fred_generation_runs[\s\S]*set status = 'cancelled'[\s\S]*status in \('preprocessing', 'connecting', 'streaming'\)/i,
    );
    expect(deletion).toMatch(
      /update public\.fred_request_ledger[\s\S]*when receipt\.status in \('received', 'user_persisted', 'generating'\) then 'cancelled'/i,
    );
    expect(deletion).toMatch(/terminal_at = case[\s\S]*then deletion_time/i);
    expect(deletion).toMatch(/request_content = null,[\s\S]*request_content_sha256 = null/i);
    expect(deletion).toMatch(
      /content_deletion_reason = coalesce\([\s\S]*receipt\.content_deletion_reason,[\s\S]*'user_conversation_delete'/i,
    );
    expect(deletion).toMatch(
      /conversation_id = null,[\s\S]*user_message_id = null,[\s\S]*assistant_message_id = null/i,
    );
    expect(deletion).toMatch(
      /from public\.fred_messages as message[\s\S]*message\.bridge_event_id in \([\s\S]*receipt\.user_event_id,[\s\S]*receipt\.assistant_event_id/i,
    );
    expect(deletion).toMatch(/receipt\.id = any\(request_ids\)/i);
    expect(deletion).toMatch(
      /delete from public\.fred_webhook_events[\s\S]*webhook\.processed_at is null/i,
    );
    expect(deletion).toMatch(
      /return query\s+delete from public\.fred_conversations[\s\S]*returning conversation\.id/i,
    );

    const ledgerDetach = deletion.indexOf("update public.fred_request_ledger");
    const pendingWebhookDelete = deletion.indexOf("delete from public.fred_webhook_events");
    const conversationDelete = deletion.indexOf("delete from public.fred_conversations");
    expect(ledgerDetach).toBeGreaterThanOrEqual(0);
    expect(pendingWebhookDelete).toBeGreaterThan(ledgerDetach);
    expect(conversationDelete).toBeGreaterThan(pendingWebhookDelete);
  });

  it("makes terminal generation runs immutable against late worker writes", () => {
    const guard = functionBody("prevent_terminal_fred_generation_run_update");

    expect(guard).toMatch(
      /old\.status in \('completed', 'failed', 'cancelled'\)[\s\S]*terminal fred generation runs are immutable/i,
    );
    expect(guard).toMatch(
      /old\.conversation_id is not null[\s\S]*new\.conversation_id is null[\s\S]*to_jsonb\(new\) - 'conversation_id' - 'updated_at'[\s\S]*is not distinct from[\s\S]*to_jsonb\(old\) - 'conversation_id' - 'updated_at'/i,
    );
    expect(migration).toMatch(
      /create trigger fred_generation_runs_terminal_immutable\s+before update on public\.fred_generation_runs/i,
    );
  });

  it("routes auth account deletion through the same tombstoning transaction", () => {
    const guard = functionBody("tombstone_fred_conversations_before_user_delete");

    expect(guard).toMatch(
      /array_agg\(conversation\.id order by conversation\.id\)[\s\S]*conversation\.client_id = old\.id/i,
    );
    expect(guard).toMatch(
      /perform public\.delete_owned_fred_conversations\(old\.id, conversation_ids\)/i,
    );
    expect(migration).toMatch(
      /create trigger auth_users_tombstone_fred_conversations\s+before delete on auth\.users[\s\S]*tombstone_fred_conversations_before_user_delete\(\)/i,
    );
    expect(functionBody("delete_owned_fred_conversations")).not.toMatch(
      /cardinality\(p_conversation_ids\) > 100/i,
    );
  });

  it("rejects null or malformed hashes at both quality-review confirmation gates", () => {
    for (const name of [
      "mark_fred_quality_review_batch_reviewed",
      "delete_confirmed_fred_quality_batch",
    ]) {
      const confirmation = functionBody(name);
      const validationIndex = confirmation.indexOf("p_expected_set_sha256 is null");
      const batchLockIndex = confirmation.indexOf("for update;");

      expect(validationIndex).toBeGreaterThanOrEqual(0);
      expect(batchLockIndex).toBeGreaterThan(validationIndex);
      expect(confirmation).toMatch(
        /btrim\(p_expected_set_sha256\) !~ '\^\[0-9A-Fa-f\]\{64\}\$'[\s\S]*errcode = '22023'/i,
      );
      expect(confirmation).toMatch(
        /expected_set_sha256 := lower\(btrim\(p_expected_set_sha256\)\)/i,
      );
      expect(confirmation).toMatch(
        /batch\.candidate_count is distinct from cardinality\([^)]+\)[\s\S]*batch\.candidate_set_sha256 is distinct from candidate_hash[\s\S]*batch\.candidate_set_sha256 is distinct from expected_set_sha256/i,
      );
    }
  });

  it("locks a quality batch in the global account-session-conversation-queue-receipt order", () => {
    const deletion = functionBody("delete_confirmed_fred_quality_batch");
    const accountLockIndex = deletion.indexOf("lock_existing_findog_account");
    const sessionLockIndex = deletion.indexOf("perform pg_advisory_xact_lock");
    const conversationLockIndex = deletion.indexOf("for key share", sessionLockIndex);
    const queueLockIndex = deletion.indexOf("for telegram_update_row in", conversationLockIndex);
    const receiptLockIndex = deletion.indexOf("for receipt_row in", queueLockIndex);
    const candidateRevalidationIndex = deletion.indexOf(
      "into revalidated_candidate_ids",
      receiptLockIndex,
    );
    const statusRevalidationIndex = deletion.indexOf(
      "receipt.status not in ('completed', 'failed', 'cancelled')",
      candidateRevalidationIndex,
    );

    expect(accountLockIndex).toBeGreaterThanOrEqual(0);
    expect(sessionLockIndex).toBeGreaterThan(accountLockIndex);
    expect(conversationLockIndex).toBeGreaterThan(sessionLockIndex);
    expect(queueLockIndex).toBeGreaterThan(conversationLockIndex);
    expect(receiptLockIndex).toBeGreaterThan(queueLockIndex);
    expect(candidateRevalidationIndex).toBeGreaterThan(receiptLockIndex);
    expect(statusRevalidationIndex).toBeGreaterThan(candidateRevalidationIndex);
    expect(deletion).toMatch(/array_agg\(owner\.client_id order by owner\.client_id\)/i);
    expect(deletion).toMatch(/order by lock_key, conversation\.id/i);
    expect(deletion).toMatch(/order by conversation\.id\s+for key share/i);
    expect(deletion).toMatch(/order by telegram_update\.id\s+for update/i);
    expect(deletion).toMatch(/order by receipt\.id\s+for update/i);
    expect(deletion).toMatch(
      /revalidated_candidate_ids is distinct from candidate_ids[\s\S]*revalidated_conversation_ids is distinct from conversation_ids[\s\S]*revalidated_telegram_update_ids is distinct from telegram_update_ids[\s\S]*revalidated_account_ids is distinct from account_ids/i,
    );
    expect(deletion).not.toMatch(/auth\.users/i);
  });

  it("fails closed while Telegram delivery is active and never overwrites a user deletion", () => {
    const deletion = functionBody("delete_confirmed_fred_quality_batch");
    const receiptLockIndex = deletion.indexOf("for receipt_row in");
    const activeQueueIndex = deletion.indexOf(
      "telegram_update.status in ('pending', 'retry', 'processing')",
      receiptLockIndex,
    );
    const receiptRedactionIndex = deletion.indexOf(
      "update public.fred_request_ledger as receipt",
      activeQueueIndex,
    );

    expect(activeQueueIndex).toBeGreaterThan(receiptLockIndex);
    expect(receiptRedactionIndex).toBeGreaterThan(activeQueueIndex);
    expect(deletion).toMatch(
      /still contains undelivered telegram requests'[\s\S]*errcode = '55000'/i,
    );
    expect(deletion).toMatch(
      /content_deletion_reason = 'quality_batch'[\s\S]*receipt\.content_deleted_at is null[\s\S]*receipt\.content_deletion_reason is null/i,
    );
    expect(deletion).toMatch(
      /get diagnostics redacted_receipt_count = row_count[\s\S]*redacted_receipt_count is distinct from cardinality\(revalidated_candidate_ids\)::bigint/i,
    );
    expect(deletion).toMatch(
      /get diagnostics updated_batch_count = row_count[\s\S]*updated_batch_count is distinct from 1::bigint/i,
    );
  });

  it("keeps confirmed quality cleanup QA-only", () => {
    const deletion = functionBody("delete_confirmed_fred_quality_batch");

    expect(deletion).toMatch(
      /delete from public\.admin_request_history[\s\S]*request_id = any\(revalidated_candidate_ids\)/i,
    );
    expect(deletion).toMatch(
      /update public\.telegram_deliveries[\s\S]*set message_content = ''/i,
    );
    expect(deletion).not.toMatch(/delete from public\.fred_messages/i);
    expect(deletion).not.toMatch(/delete from public\.fred_conversations/i);
    expect(deletion).not.toMatch(/delete from public\.fred_webhook_events/i);
    expect(deletion).toMatch(/'deleted_messages', 0/i);
    expect(deletion).toMatch(/'preserved_user_messages', preserved_message_count/i);
  });

  it("never reads auth.users directly from security-invoker runtime functions", () => {
    expect(migration).not.toMatch(/from auth\.users as account/i);
  });

  it("exposes only the runtime-callable functions to service_role", () => {
    for (const signature of [
      "fred_conversation_session_sha256\\(text, text\\)",
      "record_fred_bridge_event\\(jsonb\\)",
      "record_fred_webhook_event\\(jsonb\\)",
      "delete_owned_fred_conversations\\(uuid, uuid\\[\\]\\)",
      "tombstone_fred_conversations_before_user_delete\\(\\)",
    ]) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${signature}\\s+from public, anon, authenticated, service_role;[\\s\\S]*?grant execute on function public\\.${signature}\\s+to service_role;`,
        "i",
      ));
    }

    for (const signature of [
      "prevent_fred_conversation_tombstone_update\\(\\)",
      "prevent_terminal_fred_generation_run_update\\(\\)",
      "guard_deleted_fred_conversation_session\\(\\)",
    ]) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${signature}\\s+from public, anon, authenticated, service_role;`,
        "i",
      ));
      expect(migration).not.toMatch(new RegExp(
        `grant execute on function public\\.${signature}`,
        "i",
      ));
    }
  });
});
