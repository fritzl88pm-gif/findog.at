import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const migrationName = "20260927132000_merge_unpaired_fred_webhook_answers.sql";
const migration = readFileSync(join(migrationsDir, migrationName), "utf8");
const sql = migration.replace(/^\s*--.*$/gm, "");

/**
 * Every `<table>.<column>` that references fred_messages in the given SQL, in
 * any form: inline in `create table [if not exists]`, via `alter table ... add
 * column`, or as a `foreign key (...)` constraint. An occurrence whose table or
 * column cannot be read is returned as `unparsed@<offset>` so it fails loudly.
 */
function fredMessageReferencesIn(text: string): string[] {
  const code = text.replace(/--.*$/gm, "");
  return [...code.matchAll(/\breferences\s+(?:public\.)?fred_messages\b/gi)].map((match) => {
    const statement = code.slice(code.lastIndexOf(";", match.index) + 1, match.index);
    const table = statement.match(
      /\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?(?:\s+only)?)\s+(?:public\.)?(\w+)/i,
    )?.[1];
    const column = statement.match(/(?:foreign\s+key\s*\(\s*(\w+)\s*\)|(\w+)\s+bigint\b)[^,]*$/i);
    const columnName = column?.[1] ?? column?.[2];
    return table && columnName ? `${table}.${columnName}` : `unparsed@${match.index}`;
  });
}

/** Every `<table>.<column>` that references fred_messages in any migration. */
function fredMessageReferences(): string[] {
  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .flatMap((fileName) => fredMessageReferencesIn(readFileSync(join(migrationsDir, fileName), "utf8")));
}

describe("merge unpaired Fred webhook answers migration", () => {
  it("pairs bridge-only and webhook-only assistant rows on whitespace-trimmed content", () => {
    expect(sql).toMatch(
      /btrim\(bridge_message\.content, E' \\t\\r\\n\\f\\v'\)\s*=\s*btrim\(webhook_message\.content, E' \\t\\r\\n\\f\\v'\)/,
    );
    expect(sql).toMatch(/bridge_message\.role = 'assistant'/);
    expect(sql).toMatch(/webhook_message\.role = bridge_message\.role/);
    expect(sql).toMatch(/webhook_message\.conversation_id = bridge_message\.conversation_id/);
    expect(sql).toMatch(/webhook_message\.client_id = bridge_message\.client_id/);
    expect(sql).toMatch(/bridge_message\.bridge_event_id is not null\s+and bridge_message\.webhook_event_id is null/);
    expect(sql).toMatch(/webhook_message\.bridge_event_id is null\s+and webhook_message\.webhook_event_id is not null/);
    expect(sql).toMatch(
      /abs\(extract\(epoch from \(\s*coalesce\(bridge_message\.provider_created_at, bridge_message\.created_at\)\s*- webhook\.provider_created_at\s*\)\)\) <= 300/,
    );
  });

  it("merges only one-to-one matches", () => {
    expect(sql).toMatch(/count\(\*\) over \(partition by candidate\.bridge_message_id\) as bridge_candidates/);
    expect(sql).toMatch(/count\(\*\) over \(partition by candidate\.webhook_message_id\) as webhook_candidates/);
    expect(sql).toMatch(/counted\.bridge_candidates = 1\s+and counted\.webhook_candidates = 1/);
  });

  it("keeps a webhook-only row that carries metadata", () => {
    for (const condition of [
      "webhook_message.display_content is null",
      "webhook_message.content_transformation is null",
      "webhook_message.research_trace = '[]'::jsonb",
      "webhook_message.source_references = '[]'::jsonb",
      "webhook_message.execution_trace = '[]'::jsonb",
      "webhook_message.artifacts = '[]'::jsonb",
      "webhook_message.attachments = '[]'::jsonb",
      "not webhook_message.native_metadata_recorded",
    ]) {
      expect(sql).toContain(condition);
    }
  });

  it("finds a fred_messages reference in every form a migration may declare it", () => {
    expect(fredMessageReferencesIn(`
      create table if not exists public.a (
        id bigint primary key,
        message_id bigint not null references public.fred_messages (id) on delete cascade
      );
      alter table public.b add column if not exists message_id bigint
        references public.fred_messages(id) on delete set null;
      alter table only public.c
        add constraint c_message_fkey foreign key (message_id) references fred_messages(id);
      -- alter table public.d add column message_id bigint references public.fred_messages(id);
      create table public.e (other_id bigint references public.fred_messages_archive(id));
    `)).toEqual(["a.message_id", "b.message_id", "c.message_id"]);
  });

  it("keeps a webhook-only row that any table references", () => {
    const references = fredMessageReferences();
    expect(references).toEqual(expect.arrayContaining([
      "fred_public_answer_shares.question_message_id",
      "fred_public_answer_shares.assistant_message_id",
      "fred_native_image_artifacts.user_message_id",
      "fred_request_ledger.user_message_id",
      "fred_request_ledger.assistant_message_id",
    ]));
    // Lock first, so a reference committed concurrently is seen or waits.
    const lockAt = sql.search(/for update of message;/);
    const checkAt = sql.search(/delete from pg_temp\.fred_unpaired_answer_merge/);
    expect(lockAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(lockAt);
    const check = sql.slice(checkAt, sql.indexOf(";", checkAt));
    for (const reference of references) {
      const [table, column] = reference.split(".");
      expect(check).toMatch(new RegExp(`from public\\.${table} as (\\w+)[\\s\\S]*?\\1\\.${column} = merge\\.webhook_message_id`));
    }
  });

  it("moves the webhook event onto the bridge row like a normal pairing and deletes the echo row", () => {
    const deleteAt = sql.search(/delete from public\.fred_messages as message\s+using pg_temp\.fred_unpaired_answer_merge as merge\s+where message\.id = merge\.webhook_message_id;/);
    const updateAt = sql.search(/update public\.fred_messages as message/);
    expect(deleteAt).toBeGreaterThan(-1);
    // webhook_event_id is unique, so the echo row must go first.
    expect(updateAt).toBeGreaterThan(deleteAt);
    const update = sql.slice(updateAt, sql.indexOf(";", updateAt));
    expect(update).toMatch(/set webhook_event_id = merge\.webhook_event_id,/);
    expect(update).toMatch(
      /provider_created_at = least\(\s*coalesce\(message\.provider_created_at, merge\.webhook_created_at\),\s*merge\.webhook_created_at\s*\)/,
    );
    expect(update).toMatch(/where message\.id = merge\.bridge_message_id$/);
    // The bridge row keeps its stored answer, so a retried bridge event still matches it.
    expect(update).not.toMatch(/\bcontent\s*=|display_content/);
  });

  it("does not redefine the event functions", () => {
    expect(sql).not.toMatch(/create (?:or replace )?function/i);
  });
});
