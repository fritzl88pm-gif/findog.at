import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260927120000_harden_telegram_queue_cancellation.sql",
    import.meta.url,
  )),
  "utf8",
).toLowerCase();

function functionBody(name: string): string {
  const start = migration.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("\n$$;", start);
  return migration.slice(start, end);
}

describe("telegram queue hardening migration", () => {
  it("re-checks claim eligibility on the locked row and in the claiming update", () => {
    const claim = functionBody("claim_telegram_updates_for_lane");
    expect(claim).toContain("p_lease_id uuid,\n  p_lease_seconds integer default 60,\n  p_limit integer default 10,\n  p_controls_only boolean default false\n)");
    expect(claim).toContain("returns setof public.telegram_updates");
    const claimed = claim.slice(claim.indexOf("claimed as ("), claim.indexOf("for update of queued_update skip locked"));
    expect(claimed).toMatch(/where queued_update\.status in \('pending', 'retry'\)\s+and queued_update\.available_at <= now\(\)/);
    expect(claim).toMatch(/where queued_update\.id = claimed\.id\s+and queued_update\.status in \('pending', 'retry'\)\s+returning queued_update\.\*/);
    expect(migration).toContain("grant execute on function public.claim_telegram_updates_for_lane(uuid, integer, integer, boolean) to service_role");
  });

  it("lets /stop cancel older queued or backing-off questions of its chat", () => {
    const cancel = functionBody("request_stop_for_telegram_chat");
    const queued = cancel.slice(cancel.indexOf("update public.telegram_updates as queued_update"));
    expect(queued).toContain("set cancel_requested = true");
    expect(queued).toContain("available_at = least(queued_update.available_at, now())");
    expect(queued).toContain("queued_update.status in ('pending', 'retry')");
    expect(queued).toContain("queued_update.update_kind = 'message'");
    expect(queued).toContain("queued_update.update_id < stop_update_id");
    expect(queued).toMatch(/not exists \(\s+select 1\s+from public\.telegram_deliveries as delivery\s+where delivery\.update_id = queued_update\.id/);
    // Queued rows are flagged before the processing lookup so a concurrent claim is still caught.
    expect(cancel.indexOf("update public.telegram_updates as queued_update"))
      .toBeLessThan(cancel.indexOf("telegram_update.status = 'processing'"));
  });

  it("makes /stop report a running answer that is already being delivered instead of a cancellation", () => {
    const stop = functionBody("request_stop_for_telegram_chat");
    expect(migration).toContain("create function public.request_stop_for_telegram_chat(");
    expect(stop).toContain("returns text");
    const tooLate = stop.slice(stop.indexOf("and delivery.status = 'pending'"));
    expect(tooLate.slice(0, tooLate.indexOf("end if;")))
      .toContain("return case when queued_cancelled then 'too_late_queued_cancelled' else 'too_late' end;");
    expect(stop).toContain("return case when queued_cancelled then 'cancelled' else 'nothing' end;");
    expect(stop).toContain("return case when found or queued_cancelled then 'cancelled' else 'nothing' end;");
    // Workers deployed before the status RPC keep their boolean contract.
    const legacy = functionBody("request_cancel_telegram_update_for_chat");
    expect(legacy).toContain("returns boolean");
    expect(legacy).toMatch(/select public\.request_stop_for_telegram_chat\(\s+p_integration_id,\s+p_telegram_chat_id,\s+p_exclude_update_id\s+\) = 'cancelled';/);
  });

  it("serializes /stop with disconnect and bot swap on the integration row before any queue row", () => {
    const stop = functionBody("request_stop_for_telegram_chat");
    const stopLock = stop.indexOf("from public.telegram_integrations as integration\n  where integration.id = p_integration_id\n  for share;");
    expect(stopLock).toBeGreaterThan(0);
    expect(stopLock).toBeLessThan(stop.indexOf("from public.telegram_updates"));

    const cancelAll = functionBody("cancel_all_telegram_updates_for_integration");
    const cancelAllLock = cancelAll.indexOf("where integration.id = p_integration_id\n  for no key update;");
    expect(cancelAllLock).toBeGreaterThan(cancelAll.indexOf("lock_existing_findog_account(v_client_id)"));
    expect(cancelAllLock).toBeLessThan(cancelAll.indexOf("update public.telegram_updates"));

    const swap = functionBody("swap_telegram_bot");
    const swapLock = swap.indexOf("from public.telegram_integrations\n  where id = p_integration_id");
    expect(swap.slice(swapLock, swap.indexOf(";", swapLock))).toContain("for update");
    expect(swapLock).toBeLessThan(swap.indexOf("update public.telegram_updates"));
  });

  it.each([
    ["cancel_all_telegram_updates_for_integration", "telegram_integration_disconnected", "lock_existing_findog_account(v_client_id)"],
    ["swap_telegram_bot", "telegram_bot_swapped", "lock_existing_findog_account(p_client_id)"],
  ])("%s closes open Fred receipts of the queue rows it drops", (name, errorCode, accountLock) => {
    const body = functionBody(name);
    const receiptUpdate = body.indexOf("update public.fred_request_ledger as receipt");
    expect(receiptUpdate).toBeGreaterThan(0);
    const receipt = body.slice(receiptUpdate, body.indexOf(";", receiptUpdate));
    expect(receipt).toContain("set status = 'cancelled'");
    expect(receipt).toContain("terminal_at = now()");
    expect(receipt).toContain(`error_code = '${errorCode}'`);
    expect(receipt).toContain("receipt.status in ('received', 'user_persisted', 'generating')");
    // Global lock order: account, then queue rows, then receipts; receipts
    // are settled before any queue row is deleted and detaches them.
    expect(body.indexOf(accountLock)).toBeGreaterThan(0);
    expect(body.indexOf(accountLock)).toBeLessThan(body.indexOf("update public.telegram_updates"));
    expect(body.indexOf("update public.telegram_updates")).toBeLessThan(receiptUpdate);
    const deleteUpdates = body.indexOf("delete from public.telegram_updates");
    if (deleteUpdates >= 0) expect(receiptUpdate).toBeLessThan(deleteUpdates);
  });

  it("keeps the service-role-only grants of every replaced function", () => {
    for (const signature of [
      "request_stop_for_telegram_chat(uuid, bigint, bigint)",
      "request_cancel_telegram_update_for_chat(uuid, bigint, bigint)",
      "cancel_all_telegram_updates_for_integration(uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${signature}\nfrom public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function public.${signature}\nto service_role;`);
    }
    expect(migration).toMatch(/revoke all on function public\.swap_telegram_bot\([^)]*\)\s+from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.swap_telegram_bot\([^)]*\)\s+to service_role;/);
  });
});
