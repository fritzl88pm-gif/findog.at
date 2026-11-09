import { describe, expect, it } from "vitest";

import {
  getLauncherChips,
  getLauncherGroups,
  getLauncherToolIds,
  LAUNCHER_GROUPS,
} from "@/lib/tools-launcher";

function summarize(isAdmin: boolean) {
  return getLauncherGroups(isAdmin).map((group) => [group.title, group.tools.map((tool) => tool.label)]);
}

describe("tools launcher entries", () => {
  it("lists every tool for administrators in the approved order", () => {
    expect(summarize(true)).toEqual([
      ["Recherche", ["BFG Suche", "BFG Suche PRO", "BFG Newsletter", "Wissensbestand"]],
      ["Dokumente", ["Dokumente scannen", "Textbausteine", "Formulare", "Downloads"]],
      ["Rechner", ["Deutsche SV-Rente", "L17b-Rechner"]],
      ["Lernen & Spiel", ["Fredrun", "Fredrun 2.0", "Quiz", "Fred Live"]],
    ]);
  });

  it("hides Quiz and Fred Live from regular users", () => {
    expect(summarize(false)).toEqual([
      ["Recherche", ["BFG Suche", "BFG Suche PRO", "BFG Newsletter", "Wissensbestand"]],
      ["Dokumente", ["Dokumente scannen", "Textbausteine", "Formulare", "Downloads"]],
      ["Rechner", ["Deutsche SV-Rente", "L17b-Rechner"]],
      ["Lernen & Spiel", ["Fredrun", "Fredrun 2.0"]],
    ]);
    expect(getLauncherToolIds(false)).not.toContain("quiz");
    expect(getLauncherToolIds(false)).not.toContain("fred-live");
  });

  it("marks exactly Quiz and Fred Live as admin-only", () => {
    const adminOnly = LAUNCHER_GROUPS.flatMap((group) => group.tools)
      .filter((tool) => tool.adminOnly)
      .map((tool) => tool.id);
    expect(adminOnly).toEqual(["quiz", "fred-live"]);
  });

  it("maps every tile to a unique view id", () => {
    const ids = getLauncherToolIds(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(14);
  });

  it("drops a group that would be empty for regular users", () => {
    const groups = getLauncherGroups(false);
    expect(groups.every((group) => group.tools.length > 0)).toBe(true);
  });
});

describe("empty-chat tool chips", () => {
  it("suggests five tools derived from the launcher groups", () => {
    expect(getLauncherChips(false).map((chip) => chip.tool.id)).toEqual([
      "bfg-decisions",
      "bfg-pro",
      "scanning",
      "german-sv-pension",
      "fredrun",
    ]);
  });

  it("never contains admin-only tools for regular users and only known launcher ids", () => {
    for (const isAdmin of [false, true]) {
      const ids = getLauncherToolIds(isAdmin);
      for (const chip of getLauncherChips(isAdmin)) {
        expect(ids).toContain(chip.tool.id);
        if (!isAdmin) expect(chip.tool.adminOnly).toBeUndefined();
      }
    }
  });
});
