import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260812120000_fred_generation_runs.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("fred_generation_runs migration", () => {
  it("creates the fred_generation_runs table", () => {
    expect(migration).toMatch(/create table public\.fred_generation_runs/i);
  });

  it("has id uuid primary key default gen_random_uuid", () => {
    expect(migration).toMatch(/id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i);
  });

  it("has client_id uuid not null references auth.users(id) on delete cascade", () => {
    expect(migration).toMatch(/client_id\s+uuid\s+not null\s+references\s+auth\.users\s*\(id\)\s+on delete cascade/i);
  });

  it("has conversation_id uuid null references fred_conversations(id) on delete set null", () => {
    expect(migration).toMatch(/conversation_id\s+uuid\s+null\s+references\s+public\.fred_conversations\s*\(id\)\s+on delete set null/i);
  });

  it("has status text not null with bounded values constraint", () => {
    expect(migration).toMatch(/status\s+text\s+not null/i);
    expect(migration).toMatch(/status in \('preprocessing',\s*'connecting',\s*'streaming',\s*'completed',\s*'failed',\s*'cancelled'\)/i);
  });

  it("has failure_phase text null with bounded values constraint", () => {
    expect(migration).toMatch(/failure_phase\s+text\s+null/i);
    expect(migration).toMatch(/failure_phase in \('preprocessing',\s*'connecting',\s*'streaming'\)/i);
  });

  it("has error_code text null constrained to ERROR_CODES values", () => {
    expect(migration).toMatch(/error_code\s+text\s+null/i);
    expect(migration).toMatch(/error_code in \(/i);
    expect(migration).toMatch(/'preprocessing_failed'/i);
    expect(migration).toMatch(/'upstream_eof_without_final'/i);
    expect(migration).toMatch(/'timeout'/i);
    expect(migration).toMatch(/'unexpected_error'/i);
  });

  it("has upstream_http_status integer null with range 100..599", () => {
    expect(migration).toMatch(/upstream_http_status\s+integer\s+null/i);
    expect(migration).toMatch(/upstream_http_status\s*>=\s*100/i);
    expect(migration).toMatch(/upstream_http_status\s*<=\s*599/i);
  });

  it("has upstream_request_id text null with max length", () => {
    expect(migration).toMatch(/upstream_request_id\s+text\s+null/i);
    expect(migration).toMatch(/char_length\(upstream_request_id\)\s*<=\s*256/i);
  });

  it("has model_route text null with max length", () => {
    expect(migration).toMatch(/model_route\s+text\s+null/i);
    expect(migration).toMatch(/char_length\(model_route\)\s*<=\s*256/i);
  });

  it("has attachment_count integer not null default 0 with nonnegative check", () => {
    expect(migration).toMatch(/attachment_count\s+integer\s+not null\s+default\s+0/i);
    expect(migration).toMatch(/attachment_count\s*>=\s*0/i);
  });

  it("has attachment_total_bytes bigint not null default 0 with nonnegative check", () => {
    expect(migration).toMatch(/attachment_total_bytes\s+bigint\s+not null\s+default\s+0/i);
    expect(migration).toMatch(/attachment_total_bytes\s*>=\s*0/i);
  });

  it("has started_at timestamptz not null default now", () => {
    expect(migration).toMatch(/started_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  });

  it("has first_delta_at timestamptz null", () => {
    expect(migration).toMatch(/first_delta_at\s+timestamptz\s+null/i);
  });

  it("has completed_at timestamptz null", () => {
    expect(migration).toMatch(/completed_at\s+timestamptz\s+null/i);
  });

  it("has updated_at timestamptz not null default now", () => {
    expect(migration).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  });

  it("does not contain sensitive payload fields (query, answer, extracted text, filenames, hashes, secrets)", () => {
    const lowerMigration = migration.toLowerCase();
    expect(lowerMigration).not.toMatch(/\bquery\b/);
    expect(lowerMigration).not.toMatch(/\banswer\b/);
    expect(lowerMigration).not.toMatch(/\bextracted/);
    expect(lowerMigration).not.toMatch(/\bfilename/);
    expect(lowerMigration).not.toMatch(/\bhash\b/);
    expect(lowerMigration).not.toMatch(/\bsecret/);
    expect(lowerMigration).not.toMatch(/\btoken\b/);
    expect(lowerMigration).not.toMatch(/\bpassword/);
  });

  it("enables RLS on fred_generation_runs", () => {
    expect(migration).toMatch(/alter table public\.fred_generation_runs enable row level security/i);
  });

  it("revokes all from public, anon, authenticated", () => {
    expect(migration).toMatch(
      /revoke all on public\.fred_generation_runs from public,\s*anon,\s*authenticated/i,
    );
  });

  it("grants select, insert, update to service_role (no delete)", () => {
    expect(migration).toMatch(
      /grant select,\s*insert,\s*update on public\.fred_generation_runs to service_role/i,
    );
    expect(migration).not.toMatch(/grant.*delete.*fred_generation_runs/i);
  });

  it("does not grant any access to anon or authenticated roles", () => {
    const lines = migration.split("\n").filter((l) =>
      l.toLowerCase().includes("grant") && l.includes("fred_generation_runs")
    );
    for (const line of lines) {
      expect(line.toLowerCase()).not.toMatch(/to\s*(public|anon|authenticated)/i);
    }
  });

  it("has exactly two indexes: chronological and unfinished/failed", () => {
    const indexLines = migration.split("\n").filter((line) =>
      line.toLowerCase().includes("create index")
    );
    expect(indexLines).toHaveLength(2);
    expect(migration).toMatch(/fgr_started_at_idx/i);
    expect(migration).toMatch(/fgr_unfinished_or_failed_partial_idx/i);
    expect(migration).toMatch(
      /where status in \('failed',\s*'preprocessing',\s*'connecting',\s*'streaming'\)/i,
    );
    expect(migration).not.toMatch(/\brunning\b/i);
  });

  it("does not have old redundant indexes", () => {
    expect(migration).not.toMatch(/fgr_client_id_idx/i);
    expect(migration).not.toMatch(/fgr_conversation_id_idx/i);
    expect(migration).not.toMatch(/fgr_status_idx/i);
    expect(migration).not.toMatch(/fgr_client_status_idx/i);
  });

  it("has an updated_at trigger", () => {
    expect(migration).toMatch(/create function public\.set_fred_generation_run_updated_at/i);
    expect(migration).toMatch(/create trigger fgr_set_updated_at/i);
    expect(migration).toMatch(/before update on public\.fred_generation_runs/i);
  });
});
