import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  getChildCategoryIds,
  MAX_REASONING_CATEGORY_NAME_CHARS,
  MAX_REASONING_CONTENT_CHARS,
  MAX_REASONING_TITLE_CHARS,
  orderReasoningCategories,
  parseCategoryInput,
  parseCategoryName,
  parseReasoningInput,
  reasoningCategoryLabel,
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
const subcatMigrationSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260730192000_user_reasoning_subcategories.sql",
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
const cssSource = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
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
      "Textbaustein-ID",
    )).toBe("2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d");
    expect(() => requireReasoningUuid("not-a-uuid", "Textbaustein-ID")).toThrow("ungültig");
  });
});

describe("category input parsing", () => {
  it("accepts name with null or omitted parentId and valid UUID", () => {
    expect(parseCategoryInput({ name: "  Umsatzsteuer " })).toEqual({
      name: "Umsatzsteuer",
      parentId: null,
    });
    expect(parseCategoryInput({ name: "Betriebsausgaben", parentId: null })).toEqual({
      name: "Betriebsausgaben",
      parentId: null,
    });
    expect(parseCategoryInput({
      name: "Vorsteuer",
      parentId: "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d",
    })).toEqual({
      name: "Vorsteuer",
      parentId: "2c1f1ddf-1f2e-4cc9-9ee5-7d340006fc8d",
    });
  });

  it("rejects malformed parentId", () => {
    expect(() => parseCategoryInput({ name: "X", parentId: "not-a-uuid" }))
      .toThrow("ungültig");
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

describe("subcategory migration", () => {
  it("adds nullable parent_id with same-owner foreign key and on-delete-restrict", () => {
    expect(subcatMigrationSource).toMatch(
      /alter table public\.user_reasoning_categories\s+add column parent_id uuid/iu,
    );
    expect(subcatMigrationSource).toMatch(
      /foreign key \(parent_id, client_id\)[\s\S]*references public\.user_reasoning_categories \(id, client_id\)[\s\S]*on delete restrict/iu,
    );
  });

  it("prevents self-parenting and enforces one-level depth via trigger", () => {
    expect(subcatMigrationSource).toMatch(
      /check \(parent_id is null or parent_id <> id\)/iu,
    );
    expect(subcatMigrationSource).toMatch(
      /create or replace function public\.enforce_reasoning_category_one_level_depth/iu,
    );
    expect(subcatMigrationSource).toMatch(
      /before insert or update on public\.user_reasoning_categories/iu,
    );
    expect(subcatMigrationSource).toContain(
      "pg_advisory_xact_lock(hashtextextended(new.client_id::text, 0))",
    );
    expect(subcatMigrationSource).toContain(
      "Kategorien unterstützen nur eine Hierarchieebene.",
    );
    expect(subcatMigrationSource).toContain(
      "Eine Kategorie mit Unterkategorien kann nicht unter eine andere Kategorie verschoben werden.",
    );
  });

  it("replaces global unique index with sibling-aware uniqueness", () => {
    expect(subcatMigrationSource).toMatch(
      /drop index if exists user_reasoning_categories_client_name_unique/iu,
    );
    expect(subcatMigrationSource).toMatch(
      /create unique index user_reasoning_categories_client_name_parent_unique/iu,
    );
    expect(subcatMigrationSource).toContain(
      "coalesce(parent_id, '00000000-0000-0000-0000-000000000000')",
    );
  });

  it("includes index on parent_id", () => {
    expect(subcatMigrationSource).toMatch(
      /create index user_reasoning_categories_parent_idx\s+on public\.user_reasoning_categories \(parent_id\)/iu,
    );
  });
});

describe("getChildCategoryIds", () => {
  it("returns parent plus all direct children when selecting a top-level category", () => {
    const childIdsByParent = new Map<string, string[]>([
      ["parent-1", ["child-a", "child-b"]],
      ["parent-2", ["child-c"]],
    ]);
    expect(getChildCategoryIds("parent-1", childIdsByParent)).toEqual([
      "parent-1",
      "child-a",
      "child-b",
    ]);
    expect(getChildCategoryIds("parent-2", childIdsByParent)).toEqual([
      "parent-2",
      "child-c",
    ]);
  });

  it("returns only the child ID when selecting a child category", () => {
    const childIdsByParent = new Map<string, string[]>([
      ["parent-1", ["child-a", "child-b"]],
    ]);
    expect(getChildCategoryIds("child-a", childIdsByParent)).toEqual(["child-a"]);
    expect(getChildCategoryIds("child-b", childIdsByParent)).toEqual(["child-b"]);
  });

  it("returns only the unknown ID value for an unrecognized category", () => {
    const childIdsByParent = new Map<string, string[]>([
      ["parent-1", ["child-a"]],
    ]);
    expect(getChildCategoryIds("unknown-id", childIdsByParent)).toEqual(["unknown-id"]);
  });

  it("returns the category itself when the map is empty", () => {
    expect(getChildCategoryIds("any-id", new Map())).toEqual(["any-id"]);
  });

  it("returns only one level deep — no recursion", () => {
    // Even if grandchildren exist by accident, only direct children are returned
    const childIdsByParent = new Map<string, string[]>([
      ["grandparent", ["parent"]],
      ["parent", ["child"]],
    ]);
    // Selecting grandparent returns grandparent and parent (direct children only)
    expect(getChildCategoryIds("grandparent", childIdsByParent)).toEqual([
      "grandparent",
      "parent",
    ]);
    // Selecting parent returns parent and child
    expect(getChildCategoryIds("parent", childIdsByParent)).toEqual([
      "parent",
      "child",
    ]);
    // Selecting child returns only child
    expect(getChildCategoryIds("child", childIdsByParent)).toEqual(["child"]);
  });
});

describe("category hierarchy presentation", () => {
  const categories = [
    { id: "parent-b", name: "Umsatzsteuer", parentId: null },
    { id: "child-a", name: "Rechnungen", parentId: "parent-a" },
    { id: "parent-a", name: "Betriebsausgaben", parentId: null },
    { id: "child-b", name: "Vorsteuer", parentId: "parent-b" },
  ];

  it("groups each direct child after its parent", () => {
    expect(orderReasoningCategories(categories).map((category) => category.id)).toEqual([
      "parent-a",
      "child-a",
      "parent-b",
      "child-b",
    ]);
  });

  it("shows the parent path for children and the plain name for top-level categories", () => {
    expect(reasoningCategoryLabel(categories[1], categories)).toBe(
      "Betriebsausgaben › Rechnungen",
    );
    expect(reasoningCategoryLabel(categories[2], categories)).toBe("Betriebsausgaben");
  });
});

describe("reasonings UI integration", () => {
  it("adds Textbausteine to expanded and collapsed navigation", () => {
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
    expect(viewSource).toContain("getChildCategoryIds(activeCategoryId, childIdsByParent)");
    expect(viewSource).toContain("Kategorie wurde gelöscht. Die Textbausteine bleiben erhalten.");
  });

  it("copies only the reasoning body without title or categories", () => {
    expect(viewSource).toMatch(
      /<CopyIconButton[\s\S]*?text=\{reasoning\.content\}[\s\S]*?Textbaustein/iu,
    );
    expect(viewSource).not.toContain("text={reasoning.title}");
    expect(viewSource).not.toContain("text={reasoning.categoryIds");
  });

  it("uses accessible edit and delete icons and emphasizes copy", () => {
    expect(
      viewSource.match(/className="reasoning-card-icon-button(?: is-danger)?"/gu),
    ).toHaveLength(2);
    expect(viewSource).toContain(
      'aria-label={`Textbaustein „${reasoning.title}“ bearbeiten`}',
    );
    expect(viewSource).toContain(
      'aria-label={`Textbaustein „${reasoning.title}“ löschen`}',
    );
    expect(cssSource).toMatch(
      /\.copy-icon-button\.reasoning-copy-button\s*\{[\s\S]*?background: var\(--bmf-blue\)/u,
    );
    expect(cssSource).toMatch(/\.reasoning-card-icon-button\.is-danger/u);
  });

  it("uses Textbausteine everywhere and no surviving Begründung product copy", () => {
    // View source must not contain any stray "Begründung" or "Begründungen"
    // as visible product language (exclude aria-label which uses Textbaustein now).
    expect(viewSource).not.toMatch(/Begründung(?!s-ID)/u);
    expect(viewSource).not.toMatch(/Begründungen/u);
    // Page source should also say Textbausteine for navigation.
    expect(pageSource).toContain("Textbausteine");
    expect(pageSource).not.toMatch(/>\s*Begründungen\s*</u);
    expect(pageSource).toContain('title="Textbausteine"');
  });

  it("shows hierarchy UI markers for subcategory disambiguation", () => {
    expect(viewSource).toContain("reasoningCategoryLabel(category, categories)");
    expect(viewSource).toContain("subcategory-label");
    expect(cssSource).toContain(".reasoning-category-list > li.is-subcategory");
    expect(cssSource).toContain(".reasoning-category-options label.subcategory-label");
  });
});
