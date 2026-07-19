import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260719072643_fred_native_attachment_metadata.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fred native attachment metadata migration", () => {
  it("stores only bounded request metadata on Fred messages", () => {
    expect(migration).toMatch(/add column attachments jsonb not null default '\[\]'::jsonb/i);
    expect(migration).toMatch(/add column web_search_enabled boolean not null default false/i);
    expect(migration).toMatch(/jsonb_array_length\(attachments\) <= 10/i);
    expect(migration).toMatch(/role = 'user'[\s\S]*attachments = '\[\]'::jsonb[\s\S]*web_search_enabled = false/i);
    expect(migration).not.toMatch(/bytea|data_uri|base64/i);
  });

  it("validates count, size, type and SHA-256 before recording metadata", () => {
    expect(migration).toMatch(/create function public\.record_fred_native_event\(payload jsonb\)/i);
    expect(migration).toMatch(/image_count > 5 or attachment_size_bytes > 10485760/i);
    expect(migration).toMatch(/file_count > 5 or attachment_size_bytes > 20971520/i);
    expect(migration).toMatch(/attachment_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/i);
    expect(migration).toMatch(/native event id metadata reuse mismatch/i);
  });

  it("keeps the new RPC service-role-only and security-invoker", () => {
    expect(migration).toMatch(/record_fred_native_event\(payload jsonb\)[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/revoke all on function public\.record_fred_native_event\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.record_fred_native_event\(jsonb\)[\s\S]*to service_role/i);
  });
});
