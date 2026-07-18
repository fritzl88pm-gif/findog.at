import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RESEARCH_RESULT_LIMIT,
  getResearchResultLimit,
  getResearchResultLimitSnapshot,
  parseResearchResultLimit,
  updateResearchResultLimit,
} from "./research-settings";

function readClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, eq };
}

function updateClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ maybeSingle });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { client: { from } as never, from, update, eq, select };
}

describe("parseResearchResultLimit", () => {
  it.each([1, 8, 50, "12"])("accepts in-range integers: %s", (value) => {
    expect(parseResearchResultLimit(value)).toBe(Number(value));
  });

  it.each([0, 51, -3, 2.5, "abc", "", "  ", null, undefined, {}, [], Number.NaN])(
    "rejects invalid values: %s",
    (value) => {
      expect(parseResearchResultLimit(value)).toBeNull();
    },
  );
});

describe("getResearchResultLimit", () => {
  it("returns the stored value and queries the singleton row", async () => {
    const { client, from, select, eq } = readClient({
      data: { research_result_limit: 12 },
      error: null,
    });
    await expect(getResearchResultLimit(client)).resolves.toBe(12);
    expect(from).toHaveBeenCalledWith("global_settings");
    expect(select).toHaveBeenCalledWith("research_result_limit");
    expect(eq).toHaveBeenCalledWith("id", true);
  });

  it.each([
    { data: null, error: null },
    { data: null, error: { code: "PGRST205" } },
    { data: { research_result_limit: 0 }, error: null },
    { data: { research_result_limit: 999 }, error: null },
    { data: { research_result_limit: "keine Zahl" }, error: null },
  ])("falls back to the default instead of throwing: %#", async (result) => {
    const { client } = readClient(result);
    await expect(getResearchResultLimit(client)).resolves.toBe(
      DEFAULT_RESEARCH_RESULT_LIMIT,
    );
  });

  it("marks stored values as database provenance", async () => {
    const { client } = readClient({
      data: { research_result_limit: 12 },
      error: null,
    });
    await expect(getResearchResultLimitSnapshot(client)).resolves.toEqual({
      value: 12,
      source: "database",
    });
  });

  it("marks missing settings as fallback provenance", async () => {
    const { client } = readClient({ data: null, error: { code: "PGRST205" } });
    await expect(getResearchResultLimitSnapshot(client)).resolves.toEqual({
      value: DEFAULT_RESEARCH_RESULT_LIMIT,
      source: "fallback",
    });
  });
});

describe("updateResearchResultLimit", () => {
  it("persists a valid limit via UPDATE on the singleton row", async () => {
    const { client, from, update, eq } = updateClient({
      data: { research_result_limit: 15 },
      error: null,
    });
    await expect(updateResearchResultLimit(client, "admin-1", 15)).resolves.toBe(15);
    expect(from).toHaveBeenCalledWith("global_settings");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ research_result_limit: 15, updated_by: "admin-1" }),
    );
    expect(eq).toHaveBeenCalledWith("id", true);
  });

  it.each([0, 51, 2.5, "abc", null, undefined])(
    "rejects an out-of-range or non-integer limit: %s",
    async (value) => {
      await expect(
        updateResearchResultLimit({ from: vi.fn() } as never, "admin-1", value),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it("fails with 503 when the settings row cannot be updated", async () => {
    const { client } = updateClient({ data: null, error: { code: "PGRST205" } });
    await expect(
      updateResearchResultLimit(client, "admin-1", 10),
    ).rejects.toMatchObject({ status: 503 });
  });
});
