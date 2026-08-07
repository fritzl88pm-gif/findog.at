import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260807064643_fred_personality_profiles.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("fred_personality_profiles migration", () => {
  it("creates the fred_personality_profiles table with all required columns", () => {
    expect(migration).toMatch(/create table public\.fred_personality_profiles/i);
    expect(migration).toMatch(/id\s+text\s+primary key/i);
    expect(migration).toMatch(/title\s+text\s+not null/i);
    expect(migration).toMatch(/prompt_text\s+text\s+not null\s+default\s+''/i);
    expect(migration).toMatch(/is_builtin\s+boolean\s+not null\s+default\s+false/i);
    expect(migration).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
    expect(migration).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  });

  it("constrains id to max 64 chars and lowercase alphanumeric plus hyphen", () => {
    expect(migration).toMatch(/fpp_id_max_length.*char_length\(id\)\s*<=\s*64/i);
    expect(migration).toMatch(/fpp_id_format.*id\s*~\s*'\^\[a-z0-9\]/i);
  });

  it("constrains title to max 80 chars", () => {
    expect(migration).toMatch(/fpp_title_max_length.*char_length\(title\)\s*<=\s*80/i);
  });

  it("constrains prompt_text to max 4000 chars", () => {
    expect(migration).toMatch(/fpp_prompt_text_max_length.*char_length\(prompt_text\)\s*<=\s*4000/i);
  });

  it("enables RLS on fred_personality_profiles", () => {
    expect(migration).toMatch(/alter table public\.fred_personality_profiles enable row level security/i);
  });

  it("revokes all from public, anon, authenticated on fred_personality_profiles", () => {
    expect(migration).toMatch(
      /revoke all on public\.fred_personality_profiles from public,\s*anon,\s*authenticated/i,
    );
  });

  it("grants full CRUD to service_role on fred_personality_profiles", () => {
    expect(migration).toMatch(
      /grant select,\s*insert,\s*update,\s*delete on public\.fred_personality_profiles to service_role/i,
    );
  });

  it("seeds the four builtin profiles idempotently", () => {
    expect(migration).toContain("'standard'");
    expect(migration).toContain("'friendly'");
    expect(migration).toContain("'efficient'");
    expect(migration).toContain("'cynical'");
    expect(migration).toMatch(/on conflict\s*\(id\)\s*do nothing/i);
  });

  it("seeds the exact German prompt texts", () => {
    // standard: empty prompt
    expect(migration).toContain("'',");
    // friendly
    expect(migration).toContain(
      "Antworte herzlich, zugewandt und gesprächig. Verwende häufiger passende Emojis, ohne fachliche Präzision, Professionalität oder Verständlichkeit zu beeinträchtigen.",
    );
    // efficient
    expect(migration).toContain(
      "Antworte prägnant, direkt und klar. Konzentriere dich auf die wesentlichen Informationen und vermeide unnötige Einleitungen, Wiederholungen und Ausschmückungen.",
    );
    // cynical
    expect(migration).toContain(
      "Antworte kritisch, trocken und sarkastisch.",
    );
    expect(migration).toContain(
      "Fachliche Präzision und Verlässlichkeit bleiben vollständig erhalten.",
    );
  });

  it("drops the old personality CHECK constraint on fred_user_preferences", () => {
    expect(migration).toMatch(/drop constraint fred_user_preferences_personality_check/i);
  });

  it("adds an FK from fred_user_preferences.personality to fred_personality_profiles(id)", () => {
    expect(migration).toMatch(
      /foreign key\s*\(personality\)\s*references\s*public\.fred_personality_profiles\s*\(id\)/i,
    );
    expect(migration).toMatch(/on update cascade/i);
    expect(migration).toMatch(/on delete restrict/i);
  });

  it("preserves the default 'standard' on fred_user_preferences.personality", () => {
    // The migration should not alter the default — it only replaces the CHECK with an FK.
    // The original migration set the default, so verify our migration does NOT drop the default.
    expect(migration).not.toMatch(/alter table.*fred_user_preferences.*alter column personality.*drop default/i);
  });

  it("preserves existing role grants on fred_user_preferences", () => {
    expect(migration).toMatch(/revoke all on public\.fred_user_preferences from public,\s*anon,\s*authenticated/i);
    expect(migration).toMatch(
      /grant select,\s*insert,\s*update,\s*delete on public\.fred_user_preferences to service_role/i,
    );
  });

  it("does not grant ANY client-side access to fred_personality_profiles", () => {
    // Ensure no grant to public, anon, or authenticated
    const lines = migration.split("\n").filter((l) =>
      l.toLowerCase().includes("grant") && l.includes("fred_personality_profiles")
    );
    for (const line of lines) {
      expect(line.toLowerCase()).not.toMatch(/to\s*(public|anon|authenticated)/i);
    }
  });

  it("does not drop, delete, or truncate existing data in fred_user_preferences", () => {
    expect(migration).not.toMatch(/drop table.*fred_user_preferences/i);
    expect(migration).not.toMatch(/delete from.*fred_user_preferences/i);
    expect(migration).not.toMatch(/truncate.*fred_user_preferences/i);
  });
});
