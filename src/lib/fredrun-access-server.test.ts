import { describe, expect, it, vi } from "vitest";

import {
  assertFredRunAccessAllowed,
  FredRunAccessBlockedServerError,
} from "./fredrun-access-server";

function createClient(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  const from = vi.fn().mockReturnValue(builder);
  return { client: { from }, from, builder };
}

describe("assertFredRunAccessAllowed", () => {
  it("allows users without an active block", async () => {
    const mock = createClient({ data: null, error: null });
    await expect(assertFredRunAccessAllowed(mock.client as never, "user-1")).resolves.toBeUndefined();
    expect(mock.from).toHaveBeenCalledWith("fredrun_user_blocks");
    expect(mock.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns the configured block message", async () => {
    const message = "bitte noch 1432 VKs erledigen um weiter zu spielen...";
    const mock = createClient({ data: { message }, error: null });
    await expect(assertFredRunAccessAllowed(mock.client as never, "user-1"))
      .rejects.toEqual(expect.objectContaining({
        name: "FredRunAccessBlockedServerError",
        message,
        status: 403,
      }));
    await expect(assertFredRunAccessAllowed(
      createClient({ data: { message }, error: null }).client as never,
      "user-1",
    )).rejects.toBeInstanceOf(FredRunAccessBlockedServerError);
  });

  it("fails closed on query errors and invalid stored messages", async () => {
    for (const result of [
      { data: null, error: { message: "private detail" } },
      { data: { message: " bad " }, error: null },
    ]) {
      const mock = createClient(result);
      await expect(assertFredRunAccessAllowed(mock.client as never, "user-1"))
        .rejects.toEqual(expect.objectContaining({ status: 503 }));
    }
  });
});
