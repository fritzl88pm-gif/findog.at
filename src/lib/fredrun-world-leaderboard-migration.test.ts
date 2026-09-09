import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// Opt in with an external PGlite installation; never accepts a database URL.
const enginePath = process.env.FREDRUN_TEST_PGLITE_PATH;
const migrationPath = "supabase/migrations/20260909090000_fredrun_world_leaderboards.sql";
const readMigration = (path: string) => readFileSync(path, "utf8");

describe("additive world leaderboard migration", () => {
  it("does not reset scores, economy, personal bests or block guards", () => {
    const sql = readMigration(migrationPath);
    expect(sql).not.toMatch(/\b(delete|truncate|drop|disable trigger)\b/i);
    expect(sql).not.toMatch(/update public\.fredrun_(scores|user_progress|user_unlocks|user_blocks)/i);
    expect(sql).toMatch(/world_id text/);
    expect(sql).toMatch(/world_id, score desc, created_at asc, id asc/);
  });
});

describe.skipIf(!enginePath)("world leaderboard PostgreSQL contract (isolated PGlite)", () => {
  let db: {exec(sql: string): Promise<unknown>; query<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<{rows: T[]}>; close(): Promise<void>};
  const player = randomUUID();
  const blocked = randomUUID();
  const legacyRun = randomUUID();
  const submit = (world: unknown, run = randomUUID(), score = 100, user = player) => db.query(
    "select public.submit_fredrun_world_score($1, $2, 'Fred', $3, $4) as inserted", [user, run, score, world],
  );
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ enginePath!);
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);");
    for (const file of ["20260719171431_fredrun_highscores.sql", "20260817073451_fredrun_user_progress.sql", "20260817130855_block_fredrun_user_access.sql", "20260819103000_add_alps_world.sql"]) {
      await db.exec(readMigration(`supabase/migrations/${file}`));
    }
    await db.query("insert into auth.users values ($1), ($2)", [player, blocked]);
    await db.query("select public.ensure_fredrun_user_progress($1)", [player]);
    await db.query("select public.submit_fredrun_score($1,$2,'Fred',999999)", [player, legacyRun]);
    await db.query("insert into public.fredrun_user_blocks(user_id,message,reason_code,blocked_by,provenance) values ($1,'Gesperrt','test','test','test')", [blocked]);
    await db.exec(readMigration(migrationPath));
    await db.exec("set role service_role");
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it("keeps old RPC writes unknown before and after migration and excludes them", async () => {
    await db.query("select public.submit_fredrun_score($1,$2,'Fred',999999)", [player, randomUUID()]);
    expect((await db.query("select world_id from public.fredrun_scores")).rows).toEqual([{world_id: null}, {world_id: null}]);
    for (const world of ["vienna", "finanzamt-night", "alps"]) {
      expect((await db.query("select id from public.fredrun_scores where world_id=$1", [world])).rows).toEqual([]);
    }
  });
  it("validates null/unknown world and locked purchases without changing progress", async () => {
    for (const world of [null, "", "bad", "VIENNA"]) await expect(submit(world)).rejects.toMatchObject({code: "22023"});
    await expect(submit("finanzamt-night")).rejects.toMatchObject({code: "42501"});
    expect((await db.query("select coin_balance, best_score, selected_world from public.fredrun_user_progress where user_id=$1", [player])).rows[0]).toEqual({coin_balance: 0, best_score: 0, selected_world: "vienna"});
  });
  it("persists the submitted world, preserves ties and multiple runs, and never reclassifies retries", async () => {
    const run = randomUUID();
    expect((await submit("alps", run)).rows[0]).toEqual({inserted: true});
    expect((await submit("alps", run)).rows[0]).toEqual({inserted: false});
    expect((await submit("vienna", run)).rows[0]).toEqual({inserted: false});
    expect((await submit("vienna", legacyRun)).rows[0]).toEqual({inserted: false});
    await submit("alps");
    await submit("vienna", randomUUID(), 50);
    const rows = (await db.query("select world_id, score from public.fredrun_scores where world_id='alps' order by score desc, created_at asc, id asc")).rows;
    expect(rows).toEqual([{world_id: "alps", score: 100}, {world_id: "alps", score: 100}]);
    expect((await db.query("select world_id from public.fredrun_scores where run_id=$1", [legacyRun])).rows[0]).toEqual({world_id: null});
    // Stable tie order with identical timestamps is explicitly defined by UUID.
    await db.exec("reset role");
    await db.query("update public.fredrun_scores set created_at='2026-09-01' where world_id='alps'");
    const tied = (await db.query<{id: string}>("select id from public.fredrun_scores where world_id='alps' order by score desc, created_at asc, id asc")).rows.map(r => r.id);
    expect(tied).toEqual([...tied].sort());
    await db.exec("set role service_role");
  });
  it("accepts an owned paid world independently of selected_world and keeps unlocks and coins unchanged", async () => {
    await db.exec("reset role");
    await db.query("insert into public.fredrun_user_unlocks(user_id,item_type,item_id,price_paid,provenance) values ($1,'world','finanzamt-night',500,'server_purchase')", [player]);
    const before = (await db.query("select * from public.fredrun_user_unlocks where user_id=$1 order by item_type,item_id", [player])).rows;
    await db.exec("set role service_role");
    expect((await submit("finanzamt-night")).rows[0]).toEqual({inserted: true});
    expect((await db.query("select coin_balance,best_score,selected_world from public.fredrun_user_progress where user_id=$1", [player])).rows[0]).toEqual({coin_balance: 0,best_score: 0,selected_world: "vienna"});
    expect((await db.query("select * from public.fredrun_user_unlocks where user_id=$1 order by item_type,item_id", [player])).rows).toEqual(before);
  });
  it("retains blocks, SQL checks and service-role-only execution", async () => {
    await expect(submit("vienna", randomUUID(), 100, blocked)).rejects.toMatchObject({code: "42501"});
    await expect(db.query("insert into public.fredrun_scores(user_id,run_id,score,world_id) values ($1,$2,100,'bad')", [player, randomUUID()])).rejects.toMatchObject({code: "23514"});
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await expect(submit("vienna")).rejects.toMatchObject({code: "42501"});
    }
    await db.exec("reset role; set role service_role");
  });
  it("counts legacy and all worlds toward the existing rate limit, with retries still idempotent", async () => {
    await db.exec("reset role");
    await db.query("insert into public.fredrun_scores(user_id,run_id,score) select $1, gen_random_uuid(), 1 from generate_series(1,30)", [player]);
    await db.exec("set role service_role");
    await expect(submit("vienna")).rejects.toThrow("fredrun submission rate limit exceeded");
    expect((await submit("vienna", legacyRun)).rows[0]).toEqual({inserted: false});
  });
});
