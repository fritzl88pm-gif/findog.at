import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("GET /api/bfg-newsletters", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires authentication before reading newsletters", async () => {
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));

    const response = await GET(new Request("https://findog.at/api/bfg-newsletters"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled();
  });

  it("queries active newsletters newest first", async () => {
    const query = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [], error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => query) } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1", email: "user@findog.at" });

    const response = await GET(new Request("https://findog.at/api/bfg-newsletters"));

    expect(response.status).toBe(200);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.order.mock.calls).toEqual([
      ["publication_date", { ascending: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });
});
