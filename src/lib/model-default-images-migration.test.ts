import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260715171030_global_default_and_model_icons.sql"),
  "utf8",
);

describe("global default model and model icon migration", () => {
  it("removes the privileged Flash rule and seeds DeepSeek Pro as the audited default", () => {
    expect(migration).toMatch(/drop constraint if exists model_settings_flash_enabled_check/i);
    expect(migration).toMatch(/update public\.model_settings[\s\S]*always_enabled = false[\s\S]*deepseek-v4-flash/i);
    expect(migration).toMatch(/create table public\.model_default_policy/i);
    expect(migration).toMatch(/create table public\.model_default_policy_history/i);
    expect(migration).toMatch(/insert into public\.model_default_policy[\s\S]*'deepseek-v4-pro'/i);
    expect(migration).toMatch(/model_default_policy_append_history/i);
  });

  it("allows only an enabled all-user model to become the default", () => {
    expect(migration).toMatch(/create function public\.update_global_default_model/i);
    expect(migration).toMatch(/not target\.enabled[\s\S]*target\.is_dynamic[\s\S]*access_scope is distinct from 'all'/i);
    expect(migration).toMatch(/model_settings_guard_global_default/i);
    expect(migration).toMatch(/grant execute on function public\.update_global_default_model\(uuid, text, bigint\)[\s\S]*to service_role/i);
    expect(migration).toMatch(/revoke all on function public\.update_global_default_model\(uuid, text, bigint\)[\s\S]*from public, anon, authenticated/i);
  });

  it("creates a bounded reusable icon library with no public write grants", () => {
    expect(migration).toMatch(/create table public\.model_image_assets/i);
    expect(migration).toMatch(/byte_size between 1 and 1000000/i);
    expect(migration).toMatch(/mime_type in \('image\/png', 'image\/jpeg', 'image\/webp', 'image\/avif'\)/i);
    expect(migration).toMatch(/insert into storage\.buckets[\s\S]*'model-icons'[\s\S]*true[\s\S]*1000000/i);
    expect(migration).toMatch(/alter table public\.model_image_assets enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.model_image_assets from anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert on public\.model_image_assets to service_role/i);
    expect(migration).not.toMatch(/grant[^;]*(?:insert|update|delete)[^;]*model_image_assets[^;]*(?:anon|authenticated)/i);
  });

  it("keeps model-image changes in the existing immutable model history", () => {
    expect(migration).toMatch(/add column image_asset_id uuid[\s\S]*references public\.model_image_assets/i);
    expect(migration).toMatch(/add column previous_image_asset_id uuid/i);
    expect(migration).toMatch(/insert into public\.model_settings_history[\s\S]*image_asset_id[\s\S]*previous_image_asset_id/i);
    expect(migration).toMatch(/create function public\.update_model_image/i);
    expect(migration).toMatch(/grant execute on function public\.update_model_image\(uuid, text, bigint, uuid\)[\s\S]*to service_role/i);
  });
});
