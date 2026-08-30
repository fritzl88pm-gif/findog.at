import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260830165000_resume_telegram_fred_requests.sql",
  import.meta.url,
)), "utf8");

describe("Telegram Fred request resume migration", () => {
  it("locks auth accounts through a narrow service-role-only definer helper", () => {
    expect(migration).toMatch(
      /create function public\.lock_existing_findog_account\(p_client_id uuid\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(migration).toMatch(
      /from auth\.users as account[\s\S]*?account\.id = p_client_id[\s\S]*?for key share[\s\S]*?return found/i,
    );
    expect(migration.match(/from auth\.users as account/gi)).toHaveLength(1);
    expect(migration).toMatch(
      /alter function public\.lock_existing_findog_account\(uuid\) owner to postgres/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.lock_existing_findog_account\(uuid\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.lock_existing_findog_account\(uuid\)\s+to service_role/i,
    );
  });

  it("freezes the original modes and an existing conversation at ingress", () => {
    expect(migration).toMatch(/add column web_search_enabled boolean not null default false/i);
    expect(migration).toMatch(/add column pro_mode_enabled boolean not null default false/i);
    expect(migration).toMatch(/conversation_id_value := nullif\(payload ->> 'conversation_id'/i);
    expect(migration).toMatch(/conversation\.client_id = client_id_value/i);
    expect(migration).toMatch(/ingress_context_recorded/i);
  });

  it("makes only exact non-terminal lifecycle steps idempotent", () => {
    expect(migration).toMatch(/receipt\.status not in \('received', 'user_persisted', 'generating'\)/i);
    expect(migration).toMatch(/receipt\.conversation_id is not null and receipt\.conversation_id <> conversation_id_value/i);
    expect(migration).toMatch(/message\.bridge_event_id = receipt\.user_event_id/i);
    expect(migration).toMatch(/receipt\.status not in \('user_persisted', 'generating'\)/i);
    expect(migration).toMatch(/fred request terminal state is immutable/i);
  });

  it("reconciles committed messages before deciding whether generation or delivery remains", () => {
    expect(migration).toMatch(/create function public\.resume_fred_request_receipt\(payload jsonb\)/i);
    expect(migration).toMatch(/message\.bridge_event_id = receipt\.assistant_event_id/i);
    expect(migration).toMatch(/receipt\.status in \('received', 'user_persisted', 'generating'\) and assistant_found/i);
    expect(migration).toMatch(/set status = 'completed'/i);
    expect(migration).toMatch(/coalesce\(assistant_message\.display_content, assistant_message\.content\)/i);
    expect(migration).toMatch(/fred request resume assistant provenance mismatch/i);
  });

  it("keeps every RPC service-role-only", () => {
    for (const functionName of [
      "create_fred_request_receipt",
      "transition_fred_request_receipt",
      "transition_fred_request_receipt_if_present",
      "resume_fred_request_receipt",
    ]) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${functionName}\\(jsonb\\)[\\s\\S]*?from public, anon, authenticated`,
        "i",
      ));
      expect(migration).toMatch(new RegExp(
        `grant execute on function public\\.${functionName}\\(jsonb\\)[\\s\\S]*?to service_role`,
        "i",
      ));
    }
  });

  it("lease-binds optional terminalization before touching the receipt", () => {
    const functionStart = migration.search(
      /create function public\.transition_fred_request_receipt_if_present\(payload jsonb\)/i,
    );
    const functionEnd = migration.indexOf("revoke all on function", functionStart);
    const functionSql = migration.slice(functionStart, functionEnd);

    expect(functionSql).toMatch(/returns jsonb/i);
    expect(functionSql).toMatch(/payload ->> 'telegram_update_row_id'/i);
    expect(functionSql).toMatch(/payload ->> 'telegram_lease_id'/i);
    expect(functionSql).toMatch(
      /from public\.telegram_updates\s+where id = update_row_id_value\s+for update/i,
    );
    expect(functionSql).toMatch(/telegram_update\.status is distinct from 'processing'/i);
    expect(functionSql).toMatch(/telegram_update\.lease_id is distinct from lease_id_value/i);
    expect(functionSql).not.toMatch(/telegram_update\.lease_expires_at/i);
    expect(functionSql).toMatch(/'lease_valid', false, 'receipt_present', false/i);
    expect(functionSql).toMatch(
      /select \* into receipt\s+from public\.fred_request_ledger\s+where id = request_id_value\s+for update/i,
    );
    expect(functionSql).toMatch(/'lease_valid', true, 'receipt_present', false/i);
    expect(functionSql).toMatch(/receipt\.telegram_update_id is distinct from update_row_id_value/i);
    expect(functionSql).toMatch(/'lease_valid', true, 'receipt_present', true/i);
    expect(functionSql).toMatch(/resume_result := public\.resume_fred_request_receipt\(/i);
    expect(functionSql).toMatch(/perform public\.transition_fred_request_receipt\(payload\)/i);
    expect(functionSql).toMatch(/using errcode = '40001'/i);

    const accountLock = functionSql.indexOf("lock_existing_findog_account");
    const sessionLock = functionSql.indexOf("pg_advisory_xact_lock");
    const conversationLock = functionSql.indexOf("for key share", sessionLock);
    const queueLock = functionSql.indexOf("from public.telegram_updates");
    const queueForUpdate = functionSql.indexOf("for update", queueLock);
    const receiptLock = functionSql.indexOf("for update", queueForUpdate + 1);
    const resume = functionSql.indexOf("resume_result := public.resume_fred_request_receipt");
    expect(accountLock).toBeGreaterThanOrEqual(0);
    expect(sessionLock).toBeGreaterThan(accountLock);
    expect(conversationLock).toBeGreaterThan(sessionLock);
    expect(queueLock).toBeGreaterThan(conversationLock);
    expect(queueForUpdate).toBeGreaterThan(queueLock);
    expect(receiptLock).toBeGreaterThan(queueForUpdate);
    expect(resume).toBeGreaterThan(receiptLock);
  });

  it("fences Telegram receipt creation with account, session, conversation, and queue locks", () => {
    const functionStart = migration.search(
      /create or replace function public\.create_fred_request_receipt\(payload jsonb\)/i,
    );
    const functionEnd = migration.search(
      /create or replace function public\.transition_fred_request_receipt\(payload jsonb\)/i,
    );
    const functionSql = migration.slice(functionStart, functionEnd);

    expect(functionSql).toMatch(/payload ->> 'telegram_update_row_id'/i);
    expect(functionSql).toMatch(/payload ->> 'telegram_lease_id'/i);
    expect(functionSql).toMatch(/telegram_update_id_value <> update_row_id_value/i);
    expect(functionSql).toMatch(/telegram_update\.status is distinct from 'processing'/i);
    expect(functionSql).toMatch(/telegram_update\.lease_id is distinct from lease_id_value/i);
    expect(functionSql).toMatch(/telegram_update\.lease_expires_at is null/i);
    expect(functionSql).toMatch(/telegram_update\.lease_expires_at <= now\(\)/i);
    expect(functionSql).toMatch(/return 'false'::jsonb/i);

    const accountLock = functionSql.indexOf("lock_existing_findog_account");
    const sessionLock = functionSql.indexOf("pg_advisory_xact_lock");
    const conversationLock = functionSql.indexOf("for key share", sessionLock);
    const queueLock = functionSql.indexOf("from public.telegram_updates");
    const queueForUpdate = functionSql.indexOf("for update of queued_update", queueLock);
    const receiptInsert = functionSql.indexOf("insert into public.fred_request_ledger");
    const receiptLock = functionSql.indexOf("for update", receiptInsert);
    expect(accountLock).toBeGreaterThanOrEqual(0);
    expect(sessionLock).toBeGreaterThan(accountLock);
    expect(conversationLock).toBeGreaterThan(sessionLock);
    expect(queueLock).toBeGreaterThan(conversationLock);
    expect(queueForUpdate).toBeGreaterThan(queueLock);
    expect(receiptInsert).toBeGreaterThan(queueForUpdate);
    expect(receiptLock).toBeGreaterThan(receiptInsert);
  });

  it("keeps transition and resume on the account-session-conversation-receipt hierarchy", () => {
    const transitionStart = migration.search(
      /create or replace function public\.transition_fred_request_receipt\(payload jsonb\)/i,
    );
    const resumeStart = migration.search(
      /create function public\.resume_fred_request_receipt\(payload jsonb\)/i,
    );
    const optionalStart = migration.search(
      /create function public\.transition_fred_request_receipt_if_present\(payload jsonb\)/i,
    );
    const transitionSql = migration.slice(transitionStart, resumeStart);
    const resumeSql = migration.slice(resumeStart, optionalStart);

    for (const functionSql of [transitionSql, resumeSql]) {
      const accountLock = functionSql.indexOf("lock_existing_findog_account");
      const sessionLock = functionSql.indexOf("pg_advisory_xact_lock");
      const conversationLock = functionSql.indexOf("for key share", sessionLock);
      const receiptLock = functionSql.indexOf("for update", conversationLock);
      expect(accountLock).toBeGreaterThanOrEqual(0);
      expect(sessionLock).toBeGreaterThan(accountLock);
      expect(conversationLock).toBeGreaterThan(sessionLock);
      expect(receiptLock).toBeGreaterThan(conversationLock);
      expect(functionSql).toMatch(/provider session discovered[\s\S]*?using errcode = '40001'/i);
    }
  });

  it("serializes terminalization with deterministic bridge-event persistence", () => {
    expect(migration).toMatch(
      /create function public\.guard_terminal_fred_request_bridge_event\(\)/i,
    );
    expect(migration).toMatch(
      /where user_event_id = new\.bridge_event_id\s+or assistant_event_id = new\.bridge_event_id\s+for update/i,
    );
    expect(migration).toMatch(
      /before insert or update of bridge_event_id on public\.fred_messages/i,
    );
    expect(migration).toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\('fred:' \|\| channel_id_value \|\| ':' \|\| session_id_value, 0\)/i,
    );
  });

  it("binds every external delivery chunk to the active queue lease", () => {
    expect(migration).toMatch(/add column delivery_lease_id uuid null/i);
    expect(migration).toMatch(/create function public\.claim_telegram_delivery_chunk\(/i);
    expect(migration).toMatch(/and lease_id = p_lease_id\s+and lease_expires_at > now\(\)/i);
    expect(migration).toMatch(/select cancel_requested into update_cancel_requested[\s\S]*?for update/i);
    expect(migration).toMatch(
      /if update_cancel_requested then[\s\S]*?set status = 'cancelled'[\s\S]*?return 'cancelled'/i,
    );
    expect(migration).toMatch(/delivery\.delivery_lease_id = p_lease_id/i);
    expect(migration).toMatch(/last_error_code = 'DELIVERY_LEASE_CHANGED'/i);
    expect(migration).toMatch(/create function public\.finish_telegram_delivery_chunk\(/i);
    expect(migration).toMatch(
      /delivery\.delivery_lease_id is distinct from p_lease_id/i,
    );
    expect(migration).toMatch(
      /create trigger telegram_updates_normalize_terminal_deliveries[\s\S]*new\.status in \('completed', 'cancelled', 'failed'\)/i,
    );
    expect(migration).toMatch(
      /when status = 'pending' then 'uncertain'[\s\S]*message_content = ''/i,
    );
  });

  it("linearizes /stop with the current delivery claim", () => {
    expect(migration).toMatch(
      /create or replace function public\.request_cancel_telegram_update_for_chat\(/i,
    );
    expect(migration).toMatch(
      /from public\.telegram_updates as telegram_update[\s\S]*?for update/i,
    );
    expect(migration).toMatch(
      /delivery\.status = 'pending'\s+and delivery\.delivery_lease_id = target\.lease_id/i,
    );
    expect(migration).toMatch(/set cancel_requested = true/i);
  });

  it("leaves a stop-winning retry under lease for receipt settlement", () => {
    expect(migration).toMatch(
      /create function public\.retry_or_cancel_telegram_update\(/i,
    );
    expect(migration).toMatch(
      /from public\.telegram_updates as telegram_update[\s\S]*?for update[\s\S]*?if target\.cancel_requested then\s+return 'cancel_requested'/i,
    );
    expect(migration).toMatch(
      /if target\.cancel_requested then\s+return 'cancel_requested';[\s\S]*?set status = 'retry'/i,
    );
    expect(migration).toMatch(/return 'retried'/i);
  });

  it("reclaims cancelled cleanup after a worker crash without exhausting attempts", () => {
    expect(migration).toMatch(
      /create or replace function public\.claim_pending_telegram_updates\(/i,
    );
    expect(migration).toMatch(
      /telegram_update\.cancel_requested\s+or telegram_update\.attempt_count >= telegram_update\.max_attempts[\s\S]*as is_terminal_cleanup/i,
    );
    expect(migration).toMatch(
      /is_terminal_cleanup desc[\s\S]*is_cancel_cleanup desc[\s\S]*is_stop desc/i,
    );
    expect(migration).toMatch(
      /when queued_update\.cancel_requested then queued_update\.attempt_count[\s\S]*when queued_update\.attempt_count >= queued_update\.max_attempts[\s\S]*then queued_update\.max_attempts \+ 1[\s\S]*else queued_update\.attempt_count \+ 1/i,
    );
  });
});
