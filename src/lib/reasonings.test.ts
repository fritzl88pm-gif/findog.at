import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MAX_REASONING_CATEGORY_NAME_CHARS,
  MAX_REASONING_CONTENT_CHARS,
  MAX_REASONING_TITLE_CHARS,
  parseCategoryName,
  parseReasoningInput,
  requireReasoningUuid,
} from "./reasonings";

const migrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260727182232_user_reasonings.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const indexMigrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260727183824_user_reasoning_owner_fk_indexes.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const pageSource = readFileSync(
  fileURLToPath(new URL("../app/page.tsx", import.meta.url)),
  "utf8",
);
const viewSource = readFileSync(
  fileURLToPath(new URL("../components/reasonings-view.tsx", import.meta.url)),
  "utf8",
);

describe("reasoning input validation", () => {
  it("normalizes text and de-duplicates category assignments", () => {
    expect(parseReasoningInput({
      title: "  Fremdübliche Aufteilung  ",
      content: "  Die Aufwendungen sind sachgerecht aufzuteilen.  ",
      categoryIds: [
        "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d",
        "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d",
      ],
    })).toEqual({
      title: "Fremdübliche Aufteilung",
      content: "Die Aufwendungen sind sachgerecht aufzuteilen.",
      categoryIds: ["2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d"],
    });
  });

  it("rejects empty or oversized reasoning fields", () => {
    expect(() => parseReasoningInput({
      title: "",
      content: "Inhalt",
      categoryIds: [],
    })).toThrow("Titel");
    expect(() => parseReasoningInput({
      title: "x".repeat(MAX_REASONING_TITLE_CHARS + 1),
      content: "Inhalt",
      categoryIds: [],
    })).toThrow("maximal");
    expect(() => parseReasoningInput({
      title: "Titel",
      content: "x".repeat(MAX_REASONING_CONTENT_CHARS + 1),
      categoryIds: [],
    })).toThrow("maximal");
  });

  it("validates category names and route UUIDs", () => {
    expect(parseCategoryName({ name: "  Umsatzsteuer  " })).toBe("Umsatzsteuer");
    expect(() => parseCategoryName({
      name: "x".repeat(MAX_REASONING_CATEGORY_NAME_CHARS + 1),
    })).toThrow("maximal");
    expect(requireReasoningUuid(
      "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d",
      "Begründungs-ID",
    )).toBe("2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d");
    expect(() => requireReasoningUuid("not-a-uuid", "Begründungs-ID")).toThrow("ungültig");
  });
});

describe("user reasoning schema", () => {
  it("keeps cards, categories and links user-owned at database level", () => {
    expect(migrationSource).toMatch(
      /client_id uuid not null references auth\.users\(id\) on delete cascade/iu,
    );
    expect(migrationSource).toMatch(
      /foreign key \(reasoning_id, client_id\)[\s\S]*user_reasonings\(id, client_id\)/iu,
    );
    expect(migrationSource).toMatch(
      /foreign key \(category_id, client_id\)[\s\S]*user_reasoning_categories\(id, client_id\)/iu,
    );
    expect(migrationSource).toMatch(
      /primary key \(reasoning_id, category_id\)/iu,
    );
  });

  it("enables RLS, denies browser roles and restricts the atomic save RPC", () => {
    expect(migrationSource.match(/enable row level security/giu)).toHaveLength(3);
    expect(migrationSource).toMatch(
      /revoke all on table[\s\S]*from anon, authenticated/iu,
    );
    expect(migrationSource).toMatch(
      /create function public\.save_user_reasoning[\s\S]*security invoker/iu,
    );
    expect(migrationSource).toMatch(
      /revoke all on function public\.save_user_reasoning[\s\S]*from public, anon, authenticated/iu,
    );
    expect(migrationSource).toMatch(
      /grant execute on function public\.save_user_reasoning[\s\S]*to service_role/iu,
    );
  });

  it("validates category ownership before replacing assignments atomically", () => {
    expect(migrationSource).toMatch(
      /category\.client_id = p_client_id[\s\S]*category\.id = any\(p_category_ids\)/iu,
    );
    expect(migrationSource).toContain("reasoning category ownership mismatch");
    expect(migrationSource).toMatch(
      /delete from public\.user_reasoning_category_links[\s\S]*insert into public\.user_reasoning_category_links/iu,
    );
  });

  it("covers both composite owner foreign keys for cascaded deletes", () => {
    expect(indexMigrationSource).toMatch(
      /user_reasoning_category_links \(reasoning_id, client_id\)/iu,
    );
    expect(indexMigrationSource).toMatch(
      /user_reasoning_category_links \(category_id, client_id\)/iu,
    );
  });
});

describe("reasonings UI integration", () => {
  it("adds Begründungen to expanded and collapsed navigation", () => {
    expect(pageSource.match(/onClick=\{openReasoningsView\}/gu)).toHaveLength(2);
    expect(pageSource).toContain('appView === "reasonings"');
    expect(pageSource).toContain(
      '<ReasoningsView accessToken={session?.access_token ?? ""} />',
    );
  });

  it("supports card CRUD, category CRUD, filtering and multiple category assignments", () => {
    expect(viewSource).toContain('fetch("/api/reasonings"');
    expect(viewSource).toContain('method: editor.id ? "PATCH" : "POST"');
    expect(viewSource).toContain('method: "DELETE"');
    expect(viewSource).toContain('fetch("/api/reasoning-categories"');
    expect(viewSource).toContain("toggleEditorCategory");
    expect(viewSource).toContain("reasoning.categoryIds.includes(activeCategoryId)");
    expect(viewSource).toContain("Kategorie wurde gelöscht. Die Begründungen bleiben erhalten.");
  });

  it("copies only the reasoning body without title or categories", () => {
    expect(viewSource).toMatch(
      /<CopyIconButton[\s\S]*?text=\{reasoning\.content\}[\s\S]*?Begründungstext/iu,
    );
    expect(viewSource).not.toContain("text={reasoning.title}");
    expect(viewSource).not.toContain("text={reasoning.categoryIds");
  });
});
