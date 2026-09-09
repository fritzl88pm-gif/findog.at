// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FredRunLeaderboard } from "@/components/fredrun-leaderboard";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
describe("rendered Fredrun podium", () => {
  it.each([0, 1, 2, 10])("renders %i entrants in accessible rank order, without invented scores", async count => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const entries = Array.from({length: count}, (_, i) => ({rank: i + 1, name: "W".repeat(20), score: 1_000_000 - i}));
    await act(async () => root.render(createElement(FredRunLeaderboard, {world: "alps", selectWorld: () => {}, entries, state: "ready", error: "", retry: () => {}})));
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe("Alpenpanorama");
    expect(container.querySelectorAll(".fredrun-podium li")).toHaveLength(Math.min(count, 3));
    expect(container.querySelectorAll(".fredrun-leaderboard-entry")).toHaveLength(Math.max(0, count - 3));
    const ranked = [...container.querySelectorAll("li")];
    ranked.forEach((li, i) => {
      expect(li.textContent).toContain(entries[i].name);
      expect(li.textContent).toContain(entries[i].score.toLocaleString("de-AT"));
      if (i < 3) {
        expect(li.textContent).toContain(`Platz ${i+1}`);
        expect(li.querySelector('svg[aria-hidden="true"] path')).not.toBeNull();
      }
    });
    if (!count) expect(container.textContent).toContain("Noch keine Runden in Alpenpanorama");
    await act(async () => root.unmount());
  });
});
