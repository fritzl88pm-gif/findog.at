import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

export const FINDOG_AGENT_MIGRATION_PATH = fileURLToPath(new URL(
  "../../../supabase/migrations/20260910212000_findog_independent_agent.sql",
  import.meta.url,
));

const BOOTSTRAP_SQL = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create role anon;
create role authenticated;
create role service_role;
`;

export type FindogAgentTestDb = {
  db: PGlite;
  close: () => Promise<void>;
};

/**
 * Boots an isolated embedded PostgreSQL-compatible database with stub Supabase
 * roles, `auth.users` and `admin_users`, then applies the real migration.
 *
 * The database is real PostgreSQL (PGlite is PostgreSQL 18 compiled to WASM) and
 * runs the real SQL functions. It has a single connection, so it cannot model
 * multi-process worker concurrency (two simultaneous `SKIP LOCKED` sessions).
 */
export async function createFindogAgentTestDb(): Promise<FindogAgentTestDb> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP_SQL);
  await db.exec(readFileSync(FINDOG_AGENT_MIGRATION_PATH, "utf8"));
  return {
    db,
    close: async () => {
      await db.close();
    },
  };
}

export async function createAuthUser(db: PGlite, options: { admin?: boolean } = {}): Promise<string> {
  const result = await db.query<{ id: string }>("select gen_random_uuid() as id");
  const id = result.rows[0].id;
  await db.query("insert into auth.users (id) values ($1)", [id]);
  if (options.admin !== false) {
    await db.query("insert into public.admin_users (user_id) values ($1)", [id]);
  }
  return id;
}

export const TEST_LEASE_TOKEN = "11111111-1111-4111-8111-111111111111";
export const TEST_OTHER_LEASE_TOKEN = "22222222-2222-4222-8222-222222222222";

export async function insertSettingsRevision(
  db: PGlite,
  createdBy: string,
  settings: Record<string, unknown>,
): Promise<number> {
  const result = await db.query<{ revision: string }>(
    "select revision from public.set_findog_agent_settings(null, $1, $2::jsonb, '{}'::jsonb)",
    [createdBy, JSON.stringify(settings)],
  );
  return Number(result.rows[0].revision);
}
