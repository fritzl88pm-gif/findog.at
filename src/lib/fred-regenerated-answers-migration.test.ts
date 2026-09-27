import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260927130000_fred_regenerated_answers.sql",
    import.meta.url,
  )),
  "utf8",
);

function functionBody(): string {
  const start = migration.indexOf("create function public.supersede_regenerated_fred_answer(");
  const end = migration.indexOf("$$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, end);
}

describe("fred regenerated answers migration", () => {
  it("adds nullable supersession columns without touching message content", () => {
    expect(migration).toMatch(/add column superseded_at timestamptz,/i);
    expect(migration).toMatch(
      /add column superseded_by_message_id bigint\s+references public\.fred_messages\(id\) on delete set null/i,
    );
    expect(migration).toMatch(/check \(superseded_by_message_id is null or superseded_at is not null\)/i);
    expect(migration).toMatch(/on public\.fred_messages \(superseded_by_message_id\)/i);
    expect(migration).not.toMatch(/delete from public\.fred_messages/i);
    expect(migration).not.toMatch(/set\s+content\s*=/i);
    expect(migration).not.toMatch(/display_content\s*=/i);
  });

  it("marks only through a service-role security definer RPC with an empty search path", () => {
    const body = functionBody();
    expect(body).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(
      /revoke all on function public\.supersede_regenerated_fred_answer\(uuid, uuid, bigint, bigint, bigint\)\s+from public, anon, authenticated;/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.supersede_regenerated_fred_answer\(uuid, uuid, bigint, bigint, bigint\)\s+to service_role;/i,
    );
  });

  it("checks ownership and that the replaced answer precedes the regenerated turn", () => {
    const body = functionBody();
    expect(body).toMatch(/where conversation\.id = p_conversation_id\s+and conversation\.client_id = p_client_id\s+for update;/i);
    expect(body).toMatch(/candidate\.superseded_at is null/i);
    expect(body).toMatch(/order by candidate\.provider_created_at desc nulls first, candidate\.id desc/i);
    expect(body).toMatch(/message\.id <> p_assistant_message_id or message\.role <> 'assistant'/i);
    expect(body).toMatch(/message\.id <> p_user_message_id or message\.role <> 'user'/i);
    expect(body).toMatch(/message\.id <> p_replaced_assistant_message_id or message\.role <> 'assistant'/i);
    expect(body).toMatch(/message\.role <> 'user' or message\.content <> question_content/i);
    expect(body).toMatch(/errcode = '55000'/i);
  });

  it("updates only the supersession columns of unmarked rows", () => {
    const body = functionBody();
    const update = body.slice(body.indexOf("update public.fred_messages"), body.indexOf("get diagnostics"));
    expect(update).toMatch(/set superseded_at = now\(\),\s+superseded_by_message_id = p_assistant_message_id\s+where/i);
    expect(update).toMatch(/target\.superseded_at is null/i);
    expect(update).not.toMatch(/bridge_event_id|webhook_event_id|content/i);
  });
});
