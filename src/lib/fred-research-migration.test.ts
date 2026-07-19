import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260719084653_fred_research_trace_and_citations.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fred research presentation migration", () => {
  it("preserves provider content and stores bounded presentation metadata separately", () => {
    expect(migration).toMatch(/add column display_content text/i);
    expect(migration).toMatch(/add column research_trace jsonb not null default '\[\]'::jsonb/i);
    expect(migration).toMatch(/add column source_references jsonb not null default '\[\]'::jsonb/i);
    expect(migration).toMatch(/jsonb_array_length\(research_trace\) <= 200/i);
    expect(migration).toMatch(/jsonb_array_length\(source_references\) <= 100/i);
    expect(migration).toMatch(/role = 'assistant'[\s\S]*display_content is null[\s\S]*research_trace = '\[\]'::jsonb/i);
    expect(migration).not.toMatch(/update public\.fred_messages[\s\S]*set content\s*=/i);
  });

  it("extends the service-only native RPC without weakening its security model", () => {
    expect(migration).toMatch(/create or replace function public\.record_fred_native_event\(payload jsonb\)[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/native research metadata is invalid/i);
    expect(migration).toMatch(/native event id metadata reuse mismatch/i);
    expect(migration).toMatch(/revoke all on function public\.record_fred_native_event\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.record_fred_native_event\(jsonb\)[\s\S]*to service_role/i);
  });
});
