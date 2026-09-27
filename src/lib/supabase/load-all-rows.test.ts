import { describe, expect, it, vi } from "vitest";

import { UserVisibleError } from "@/lib/errors";
import { loadAllRows, POSTGREST_PAGE_SIZE } from "./load-all-rows";

describe("loadAllRows", () => {
  it("requests consecutive pages until a short page arrives", async () => {
    const rows = Array.from({ length: 2 * POSTGREST_PAGE_SIZE + 5 }, (_, index) => index);
    const loadPage = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));

    await expect(loadAllRows<number>(loadPage, "nicht verfügbar")).resolves.toEqual(rows);
    expect(loadPage.mock.calls).toEqual([[0, 999], [1_000, 1_999], [2_000, 2_999]]);
  });

  it("asks once more after an exactly full page and stops on the empty one", async () => {
    const loadPage = vi.fn(async (from: number) => ({
      data: from === 0 ? Array.from({ length: POSTGREST_PAGE_SIZE }, (_, index) => index) : [],
      error: null,
    }));

    await expect(loadAllRows<number>(loadPage, "nicht verfügbar")).resolves.toHaveLength(POSTGREST_PAGE_SIZE);
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("fails with the caller's message instead of returning a partial list", async () => {
    const loadPage = vi.fn(async (from: number) => (from === 0
      ? { data: Array.from({ length: POSTGREST_PAGE_SIZE }, (_, index) => index), error: null }
      : { data: null, error: { message: "timeout" } }));

    const result = loadAllRows<number>(loadPage, "Downloads konnten nicht geladen werden.");

    await expect(result).rejects.toBeInstanceOf(UserVisibleError);
    await expect(result).rejects.toMatchObject({
      message: "Downloads konnten nicht geladen werden.",
      status: 503,
    });
  });
});
