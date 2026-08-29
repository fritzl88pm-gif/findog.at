import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260829131247_fred_request_ledger.sql",
  import.meta.url,
)), "utf8");

describe("Fred request ledger migration", () => {
  it("creates a private service-role ledger with bounded lifecycle states", () => {
    expect(migration).toMatch(/create table public\.fred_request_ledger/i);
    expect(migration).toMatch(/request_content text null/i);
    expect(migration).toMatch(/request_content_sha256 char\(64\) null/i);
    expect(migration).toMatch(/status in \([\s\S]*'received'[\s\S]*'completed'[\s\S]*'cancelled'/i);
    expect(migration).toMatch(/alter table public\.fred_request_ledger enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.fred_request_ledger from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert, update on public\.fred_request_ledger to service_role/i);
  });

  it("records ingress idempotently and validates message-event provenance on transitions", () => {
    expect(migration).toMatch(/create function public\.create_fred_request_receipt\(payload jsonb\)/i);
    expect(migration).toMatch(/on conflict \(id\) do nothing/i);
    expect(migration).toMatch(/fred request receipt id reuse mismatch/i);
    expect(migration).toMatch(/create function public\.transition_fred_request_receipt\(payload jsonb\)/i);
    expect(migration).toMatch(/message\.bridge_event_id = receipt\.user_event_id/i);
    expect(migration).toMatch(/message\.bridge_event_id = receipt\.assistant_event_id/i);
    expect(migration).toMatch(/fred request terminal state is immutable/i);
  });

  it("freezes a hash-bound batch and refuses deletion while requests are active", () => {
    expect(migration).toMatch(/create function public\.prepare_fred_quality_review_batch/i);
    expect(migration).toMatch(/candidate_set_sha256/i);
    expect(migration).toMatch(/quality_batch_id is null[\s\S]*content_deleted_at is null/i);
    expect(migration).toMatch(/where status = 'awaiting_review'/i);
    expect(migration).toMatch(/create function public\.mark_fred_quality_review_batch_reviewed/i);
    expect(migration).toMatch(/set status = 'pending_confirmation',[\s\S]*reviewed_at = now\(\)/i);
    expect(migration).toMatch(/create function public\.delete_confirmed_fred_quality_batch/i);
    expect(migration).toMatch(/confirmation hash mismatch/i);
    expect(migration).toMatch(/status not in \('completed', 'failed', 'cancelled'\)/i);
  });

  it("purges every local content copy while retaining a contentless deletion receipt", () => {
    expect(migration).toMatch(/delete from public\.admin_request_history[\s\S]*request_id = any\(candidate_ids\)/i);
    expect(migration).toMatch(/delete from public\.fred_webhook_events/i);
    expect(migration).toMatch(/delete from public\.fred_messages/i);
    expect(migration).toMatch(/update public\.telegram_deliveries[\s\S]*set message_content = ''/i);
    expect(migration).toMatch(/set request_content = null,[\s\S]*request_content_sha256 = null,[\s\S]*content_deleted_at = now\(\)/i);
  });

  it("adds exact audit provenance and backfills retained histories without inventing success", () => {
    expect(migration).toMatch(/add column request_id uuid null[\s\S]*references public\.fred_request_ledger\(id\) on delete cascade/i);
    expect(migration).toMatch(/not valid/i);
    expect(migration).toMatch(/where message\.role = 'user'/i);
    expect(migration).toMatch(/case when message\.next_role = 'assistant' then 'completed' else 'failed' end/i);
    expect(migration).toMatch(/legacy_unpaired/i);
  });
});
