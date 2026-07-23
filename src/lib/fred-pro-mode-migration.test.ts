import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260723123000_fred_pro_mode.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fred Pro Mode migration", () => {
  it("adds the pro_mode_enabled column with correct default and not-null constraint", () => {
    expect(migration).toMatch(/add column pro_mode_enabled boolean not null default false/i);
  });

  it("adds a CHECK constraint ensuring only user messages may have pro_mode_enabled true", () => {
    expect(migration).toMatch(/role\s*=\s*'user'\s*or\s*pro_mode_enabled\s*=\s*false/i);
  });

  it("does not rewrite or delete existing rows", () => {
    expect(migration).not.toMatch(/update public\.fred_messages[\s\S]*set pro_mode_enabled/i);
    expect(migration).not.toMatch(/delete from public\.fred_messages/i);
  });

  it("extends the native metadata function without weakening its security or validation", () => {
    expect(migration).toMatch(/create or replace function public\.record_fred_native_event\(payload jsonb\)[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/pro_mode_enabled/i);
  });

  it("validates pro_mode_enabled as a strict optional boolean, omitted defaults false", () => {
    expect(migration).toMatch(/if payload \? 'pro_mode_enabled'/i);
    expect(migration).toMatch(/jsonb_typeof\(payload -> 'pro_mode_enabled'\) is distinct from 'boolean'/i);
    expect(migration).toMatch(/raise exception[\s\S]*pro mode flag must be boolean/i);
    expect(migration).toMatch(/coalesce\(\(payload ->> 'pro_mode_enabled'\)::boolean, false\)/i);
  });

  it("rejects pro_mode_enabled true on message_received and assistant events", () => {
    expect(migration).toMatch(/message_received[\s\S]*pro_mode_enabled_value/i);
    expect(migration).toMatch(/role\s*=\s*'user'\s*or\s*pro_mode_enabled\s*=\s*false/i);
  });

  it("includes pro_mode_enabled in the metadata-reuse/idempotency comparison", () => {
    expect(migration).toMatch(/existing_pro_mode_enabled/i);
    expect(migration).toMatch(/pro_mode_enabled_value/i);
    expect(migration).toMatch(/existing_pro_mode_enabled is distinct from pro_mode_enabled_value/i);
  });

  it("writes pro_mode_enabled in the final UPDATE alongside other metadata", () => {
    expect(migration).toMatch(/update public\.fred_messages[\s\S]*set[\s\S]*pro_mode_enabled = pro_mode_enabled_value/i);
  });

  it("preserves all existing grants, security-definer search_path, and service-role-only access", () => {
    expect(migration).toMatch(/revoke all on function public\.record_fred_native_event\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.record_fred_native_event\(jsonb\)[\s\S]*to service_role/i);
  });
});
