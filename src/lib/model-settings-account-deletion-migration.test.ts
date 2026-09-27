import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const migrationName = "20260927101500_detach_deleted_model_setting_admins.sql";
const migration = readFileSync(join(migrationsDir, migrationName), "utf8");

function latestFunctionBody(name: string): { body: string; fileName: string } {
  const definitions = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .flatMap((fileName) => {
      const sql = readFileSync(join(migrationsDir, fileName), "utf8");
      return [...sql.matchAll(
        new RegExp(
          `create(?: or replace)? function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
          "gi",
        ),
      )].map((match) => ({ body: match[1], fileName }));
    });

  const latest = definitions.at(-1);
  if (!latest) {
    throw new Error(`${name} definition was not found in migrations`);
  }
  return latest;
}

describe("model settings account deletion migration", () => {
  it.each([
    ["prepare_model_settings_change", "model setting updates require an administrator id"],
    ["prepare_model_default_policy_change", "default model updates require an administrator id"],
  ])("lets %s accept only the FK detach of a deleted administrator", (name, actorError) => {
    const { body, fileName } = latestFunctionBody(name);
    expect(fileName).toBe(migrationName);

    const detach = body.match(
      /if tg_op = 'UPDATE'\s+and old\.updated_by is not null\s+and new\.updated_by is null([\s\S]*?)then\s+return new;\s+end if;/i,
    );
    expect(detach, "detach early return must exist").not.toBeNull();
    expect(detach![1]).toMatch(
      /\(to_jsonb\(new\) - 'updated_by'\) is not distinct from \(to_jsonb\(old\) - 'updated_by'\)/i,
    );
    expect(detach![1]).toMatch(
      /not exists \(\s*select 1\s+from auth\.users as account\s+where account\.id = old\.updated_by\s*\)/i,
    );

    // The detach must return before the actor check and the revision bump.
    const detachAt = body.indexOf(detach![0]);
    expect(body.indexOf(actorError)).toBeGreaterThan(detachAt);
    expect(body.indexOf("nextval(")).toBeGreaterThan(detachAt);
    expect(body).toMatch(/if tg_op = 'UPDATE' and new\.updated_by is null then\s+raise exception/i);
  });

  it.each([
    ["model_settings", "append_model_settings_history"],
    ["model_default_policy", "append_model_default_policy_history"],
  ])("appends %s history only for a new revision", (table, historyFunction) => {
    expect(migration).toMatch(
      new RegExp(`drop trigger ${table}_append_history on public\\.${table};`, "i"),
    );
    expect(migration).toMatch(
      new RegExp(
        `create trigger ${table}_append_history\\s+after insert on public\\.${table}\\s+` +
          `for each row execute function public\\.${historyFunction}\\(\\);`,
        "i",
      ),
    );
    expect(migration).toMatch(
      new RegExp(
        `create trigger ${table}_append_update_history\\s+after update on public\\.${table}\\s+` +
          `for each row\\s+when \\(new\\.revision is distinct from old\\.revision\\)\\s+` +
          `execute function public\\.${historyFunction}\\(\\);`,
        "i",
      ),
    );
    expect(migration).not.toMatch(
      new RegExp(`after insert or update on public\\.${table}\\b`, "i"),
    );
  });

  it("keeps the audit pointers as ON DELETE SET NULL and the trigger functions private", () => {
    expect(migration).not.toMatch(/drop constraint|alter table/i);
    expect(migration).toMatch(
      /revoke all on function public\.prepare_model_settings_change\(\)\s+from public, anon, authenticated;/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.prepare_model_default_policy_change\(\)\s+from public, anon, authenticated;/i,
    );
  });
});
