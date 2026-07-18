import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260718133121_research_evidence_memory_cards.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("research evidence memory migration", () => {
  it("snapshots retrieval settings and Stichtag on agent runs", () => {
    expect(migration).toMatch(/alter table public\.agent_runs[\s\S]*add column research_result_limit integer/i);
    expect(migration).toMatch(/add column research_result_limit_source text/i);
    expect(migration).toMatch(/add column research_stichtag date/i);
    expect(migration).toMatch(/research_result_limit_source in \('database', 'fallback'\)/i);
    expect(migration).toMatch(/research_result_limit_source in \('database', 'fallback'\)[\s\S]*research_stichtag_kind is not null/i);
    expect(migration).toMatch(/research_stichtag_kind = 'explicit'/i);
    expect(migration).toMatch(/research_stichtag_matched_text text/i);
    expect(migration).toMatch(/research_reference_year between 1800 and 2999/i);
  });

  it("stores full evidence separately from the compact agent trace", () => {
    expect(migration).toMatch(/create table public\.research_evidence/i);
    expect(migration).toMatch(/semantic_arguments jsonb not null/i);
    expect(migration).toMatch(/effective_arguments jsonb not null/i);
    expect(migration).toMatch(/content text not null[\s\S]*char_length\(content\) <= 32000/i);
    expect(migration).toMatch(/original_content_sha256 char\(64\)/i);
    expect(migration).toMatch(/content_truncated boolean not null/i);
    expect(migration).toMatch(/content_sha256 = pg_catalog\.encode\([\s\S]*pg_catalog\.sha256\(pg_catalog\.convert_to\(content, 'UTF8'\)\)[\s\S]*'hex'[\s\S]*\)/i);
  });

  it("keeps LLM memory fields separate from deterministic provenance", () => {
    expect(migration).toMatch(/evidence_kind in \('discovery', 'norm', 'rechtssatz', 'entscheidung_chunk', 'secondary'\)/i);
    expect(migration).toMatch(/card_summary text check/i);
    expect(migration).toMatch(/card_topics text\[\] not null/i);
    expect(migration).toMatch(/card_generation is null or card_generation in \('llm', 'fallback'\)/i);
    expect(migration).toMatch(/card_reasoning is null or card_reasoning = 'disabled'/i);
    expect(migration).toMatch(/research_evidence_non_primary_requery_check/i);
    expect(migration).toMatch(/research_evidence_authoritative_metadata_check/i);
    expect(migration).toMatch(/source_system in \('ris', 'evi'\)/i);
  });

  it("binds every evidence row to its exact successful tool-result step", () => {
    expect(migration).toMatch(/foreign key \(agent_run_id, result_step_order\)[\s\S]*references public\.agent_steps \(agent_run_id, step_order\)/i);
    expect(migration).toMatch(/step_scope\.step_type is distinct from 'tool_result'/i);
    expect(migration).toMatch(/step_scope\.tool_name is distinct from new\.semantic_tool_name/i);
    expect(migration).toMatch(/step_scope\.success is distinct from true/i);
  });

  it("enforces scope, Stichtag, and effective-limit provenance", () => {
    expect(migration).toMatch(/run_scope\.conversation_id is distinct from new\.conversation_id/i);
    expect(migration).toMatch(/run_scope\.client_id is distinct from new\.client_id/i);
    expect(migration).toMatch(/run_scope\.research_stichtag is distinct from new\.retrieval_stichtag/i);
    expect(migration).toMatch(/run_scope\.research_stichtag_kind is distinct from new\.retrieval_stichtag_kind/i);
    expect(migration).toMatch(/run_scope\.research_result_limit is distinct from new\.effective_result_limit/i);
    expect(migration).toMatch(/new\.result_limit_applied/i);
  });

  it("filters conflicting norm versions before applying the memory limit", () => {
    expect(migration).toMatch(/create view public\.research_memory_candidates/i);
    expect(migration).toMatch(/conflict\.version_id is distinct from evidence\.version_id/i);
    expect(migration).toMatch(/research_evidence_norm_conflict_idx/i);
  });

  it("uses RLS, least privilege, and lookup indexes", () => {
    expect(migration).toMatch(/alter table public\.research_evidence enable row level security/i);
    expect(migration).toMatch(/revoke all on table public\.research_evidence from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert on table public\.research_evidence to service_role/i);
    expect(migration).toMatch(/grant select on table public\.research_memory_candidates to service_role/i);
    expect(migration).toMatch(/research_evidence_conversation_scope_idx[\s\S]*conversation_id,[\s\S]*client_id,[\s\S]*retrieval_stichtag/i);
  });

  it("persists a complete turn through one service-role-only atomic RPC", () => {
    expect(migration).toMatch(/create function public\.persist_conversation_turn\(payload jsonb\)[\s\S]*returns jsonb[\s\S]*language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/insert into public\.conversations[\s\S]*insert into public\.messages[\s\S]*insert into public\.agent_runs[\s\S]*insert into public\.agent_steps[\s\S]*insert into public\.research_evidence[\s\S]*insert into public\.document_artifacts/i);
    expect(migration).toMatch(/revoke all on function public\.persist_conversation_turn\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.persist_conversation_turn\(jsonb\)[\s\S]*to service_role/i);
  });

  it("uses agent-run idempotency with database hashing and transaction locks", () => {
    expect(migration).toMatch(/add column persistence_payload_sha256 char\(64\)/i);
    expect(migration).toMatch(/payload_sha256_value := pg_catalog\.encode\([\s\S]*pg_catalog\.sha256\(pg_catalog\.convert_to\(payload::text, 'UTF8'\)\)[\s\S]*'hex'[\s\S]*\)/i);
    expect(migration).toMatch(/pg_advisory_xact_lock[\s\S]*conversation:[\s\S]*pg_advisory_xact_lock[\s\S]*agent-run:/i);
    expect(migration).toMatch(/where run\.id = agent_run_id_value[\s\S]*existing_run\.conversation_id is distinct from conversation_id_value[\s\S]*existing_run\.client_id is distinct from client_id_value[\s\S]*existing_run\.persistence_payload_sha256 is distinct from payload_sha256_value/i);
    expect(migration).toMatch(/persisted_step_count is distinct from expected_step_count[\s\S]*persisted_evidence_count is distinct from expected_evidence_count[\s\S]*persisted_artifact_count is distinct from expected_artifact_count/i);
  });

  it("forces ownership and dependent-row scope inside the RPC", () => {
    expect(migration).toMatch(/on conflict \(id\) do update[\s\S]*where public\.conversations\.client_id = excluded\.client_id/i);
    expect(migration).toMatch(/conversation_owner is distinct from client_id_value[\s\S]*conversation ownership mismatch/i);
    expect(migration).toMatch(/select[\s\S]*agent_run_id_value,[\s\S]*step\.step_order[\s\S]*from jsonb_populate_recordset\([\s\S]*null::public\.agent_steps/i);
    expect(migration).toMatch(/select[\s\S]*evidence\.id,[\s\S]*agent_run_id_value,[\s\S]*conversation_id_value,[\s\S]*client_id_value[\s\S]*from jsonb_populate_recordset\([\s\S]*null::public\.research_evidence/i);
    expect(migration).toMatch(/'assistantMessageId'[\s\S]*'agentRunId'[\s\S]*'pdfArtifacts'[\s\S]*'artifactsPersisted'/i);
  });
});
