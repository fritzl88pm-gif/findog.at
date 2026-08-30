import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

type RpcDefinition = {
  definition: string;
  fileName: string;
  grantContext: string;
};

function latestDeleteOwnedFredConversationsRpc(): RpcDefinition {
  const definitions = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .flatMap((fileName): RpcDefinition[] => {
      const migration = readFileSync(join(migrationsDir, fileName), "utf8");
      const match = migration.match(
        /create(?: or replace)? function public\.delete_owned_fred_conversations\([\s\S]*?\n\$\$;/i,
      );

      if (!match || match.index === undefined) {
        return [];
      }

      return [{
        definition: match[0],
        fileName,
        grantContext: migration.slice(match.index),
      }];
    });

  const latest = definitions.at(-1);

  if (!latest) {
    throw new Error("delete_owned_fred_conversations RPC definition was not found in migrations");
  }

  return latest;
}

const latestRpc = latestDeleteOwnedFredConversationsRpc();

describe("Fred conversation deletion RPC migrations", () => {
  it("adds a forward-only repair migration for the latest owner-scoped deletion RPC", () => {
    expect(latestRpc.fileName > "20260829133712_fred_request_ledger.sql").toBe(true);
    expect(latestRpc.definition).toMatch(/create or replace function public\.delete_owned_fred_conversations/i);
  });

  it("clears all ledger links and redacts all owned receipts atomically before deleting conversations", () => {
    const ledgerUpdates = [...latestRpc.definition.matchAll(/update public\.fred_request_ledger as receipt/gi)];
    const ledgerUpdate = latestRpc.definition.match(
      /update public\.fred_request_ledger as receipt\s+set conversation_id = null,\s+user_message_id = null,\s+assistant_message_id = null,\s+request_content = null,\s+request_content_sha256 = null,\s+content_deleted_at = now\(\),\s+content_deletion_reason = 'user_conversation_delete'\s+where receipt\.client_id = p_client_id\s+and receipt\.conversation_id = any\(owned_conversation_ids\);/i,
    )?.[0] ?? "";
    const deleteStatement = latestRpc.definition.match(
      /delete from public\.fred_conversations as conversation[\s\S]*?returning conversation\.id;/i,
    )?.[0] ?? "";

    expect(ledgerUpdates).toHaveLength(1);
    expect(ledgerUpdate).not.toBe("");
    expect(ledgerUpdate).not.toMatch(/content_deleted_at is null/i);
    expect(deleteStatement).not.toBe("");
    expect(latestRpc.definition.indexOf(ledgerUpdate)).toBeLessThan(
      latestRpc.definition.indexOf(deleteStatement),
    );
  });

  it("preserves the existing security, owner scope, cleanup, and grants", () => {
    expect(latestRpc.definition).toMatch(/returns table \(id uuid\)/i);
    expect(latestRpc.definition).toMatch(/language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/i);
    expect(latestRpc.definition).toMatch(/cardinality\(p_conversation_ids\) > 100/i);
    expect(latestRpc.definition).toMatch(/where conversation\.client_id = p_client_id[\s\S]*conversation\.id = any\(p_conversation_ids\)[\s\S]*for update/i);
    expect(latestRpc.definition).toMatch(/update public\.telegram_chat_bindings as binding[\s\S]*set active_conversation_id = null/i);
    expect(latestRpc.definition).toMatch(/delete from public\.admin_request_history as audit[\s\S]*audit\.user_id = p_client_id[\s\S]*audit\.conversation_id = any\(owned_conversation_ids\)/i);
    expect(latestRpc.definition).toMatch(/update public\.telegram_deliveries[\s\S]*set message_content = ''/i);
    expect(latestRpc.definition).toMatch(/delete from public\.fred_conversations as conversation[\s\S]*conversation\.client_id = p_client_id[\s\S]*conversation\.id = any\(owned_conversation_ids\)/i);
    expect(latestRpc.grantContext).toMatch(
      /revoke all on function public\.delete_owned_fred_conversations\(uuid, uuid\[\]\)[\s\S]*from public, anon, authenticated/i,
    );
    expect(latestRpc.grantContext).toMatch(
      /grant execute on function public\.delete_owned_fred_conversations\(uuid, uuid\[\]\)[\s\S]*to service_role/i,
    );
  });
});
