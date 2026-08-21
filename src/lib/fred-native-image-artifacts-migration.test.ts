import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260821120000_fred_native_image_artifacts.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fred native image artifacts migration", () => {
  it("creates the private fred_native_image_artifacts table with all required columns and constraints", () => {
    expect(migration).toMatch(/create table public\.fred_native_image_artifacts/i);
    expect(migration).toMatch(/id uuid primary key default gen_random_uuid\(\)/i);
    expect(migration).toMatch(/conversation_id uuid not null/i);
    expect(migration).toMatch(/client_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/user_message_id bigint not null references public\.fred_messages\(id\) on delete cascade/i);
    expect(migration).toMatch(/source_uri text not null/i);
    expect(migration).toMatch(/mime_type text not null/i);
    expect(migration).toMatch(/original_name text not null/i);
    expect(migration).toMatch(/created_at timestamptz not null default now\(\)/i);
  });

  it("enforces composite foreign key to fred_conversations with cascade", () => {
    expect(migration).toMatch(
      /foreign key\s*\(conversation_id,\s*client_id\)\s*references public\.fred_conversations\s*\(id,\s*client_id\)\s*on delete cascade/i,
    );
  });

  it("restricts MIME types to allowed image formats", () => {
    expect(migration).toMatch(
      /mime_type in \('image\/jpeg',\s*'image\/png',\s*'image\/gif',\s*'image\/webp'\)/i,
    );
  });

  it("enforces strict source URI scheme, length, no control chars, and no path traversal", () => {
    expect(migration).toMatch(/char_length\(source_uri\)\s*between\s*1\s*and\s*2048/i);
    expect(migration).toMatch(/local\|minio\|cos\|tos\|s3\|oss\|ks3\|obs/i);
  });

  it("enforces bounded, control-free original filenames", () => {
    expect(migration).toMatch(/char_length\(original_name\)\s*between\s*1\s*and\s*255/i);
  });

  it("enforces uniqueness on user_message_id and source_uri", () => {
    expect(migration).toMatch(/unique\s*\(user_message_id,\s*source_uri\)/i);
  });

  it("creates an index for owner and conversation lookups", () => {
    expect(migration).toMatch(/create index[\s\S]*on public\.fred_native_image_artifacts/i);
  });

  it("enables RLS and locks down access strictly to service_role", () => {
    expect(migration).toMatch(/alter table public\.fred_native_image_artifacts enable row level security/i);
    expect(migration).toMatch(/revoke all on table public\.fred_native_image_artifacts from (?:public, anon, authenticated|anon, authenticated, public|anon, authenticated)/i);
    expect(migration).toMatch(/grant select, insert, delete on table public\.fred_native_image_artifacts to service_role/i);
    expect(migration).not.toMatch(/create policy/i);
  });
});
