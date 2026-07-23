import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260723170000_quickfred_conversation_agent.sql",
  ),
  "utf8",
);

describe("QuickFred immutable conversation migration", () => {
  it("backfills existing conversations to Fred without rewriting channel or session provenance", () => {
    expect(migration).toMatch(
      /add column agent_key text not null default 'fred'/i,
    );
    expect(migration).toMatch(
      /add column weknora_agent_id varchar\(128\)/i,
    );
    expect(migration).not.toMatch(
      /update public\.fred_conversations\s+set\s+weknora_channel_id/i,
    );
    expect(migration).not.toMatch(/delete from public\.fred_conversations/i);
  });

  it("allows only Fred or QuickFred and requires provider provenance for QuickFred", () => {
    expect(migration).toMatch(/agent_key in \('fred', 'quickfred'\)/i);
    expect(migration).toMatch(
      /agent_key = 'fred' or weknora_agent_id is not null/i,
    );
  });

  it("prevents changing a stored logical or provider agent", () => {
    expect(migration).toMatch(
      /if new\.agent_key is distinct from old\.agent_key[\s\S]*fred conversation agent is immutable/i,
    );
    expect(migration).toMatch(
      /old\.weknora_agent_id is not null[\s\S]*provider agent is immutable/i,
    );
    expect(migration).toMatch(
      /before update of agent_key, weknora_agent_id/i,
    );
  });

  it("validates agent identity in the service-only bridge RPC and returns the logical agent", () => {
    expect(migration).toMatch(
      /create or replace function public\.record_fred_bridge_event\(payload jsonb\)[\s\S]*agent_key_value not in \('fred', 'quickfred'\)/i,
    );
    expect(migration).toMatch(/fred conversation agent mismatch/i);
    expect(migration).toMatch(/fred conversation provider agent mismatch/i);
    expect(migration).toMatch(
      /'agent_key', conversation_row\.agent_key/i,
    );
  });
});
