import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  fetchBfgDecisions,
  FindokUpstreamError,
} from "@/lib/findok/bfg-decisions";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, MAX_FINDOK_PAGE_SIZE, MAX_FINDOK_QUERY_CHARS } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/findok/bfg-decisions", () => ({
  fetchBfgDecisions: vi.fn(),
  FindokUpstreamError: class FindokUpstreamError extends Error {},
  normalizeFindokQuery: (value: string) => value.replace(/\s+/g, " ").trim(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function request(search = "?q=Umsatzsteuer&page=1&size=10", authorization = true): Request {
  return new Request(`http://localhost/api/findok/bfg${search}`, {
    headers: authorization ? { Authorization: "Bearer access-token" } : {},
  });
}

const successPayload = {
  results: [],
  page: 1,
  pageSize: 10,
  totalPages: 0,
  totalCount: 0,
};

describe("GET /api/findok/bfg", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(fetchBfgDecisions).mockResolvedValue(successPayload);
  });

  it("requires authentication before querying Findok", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await GET(request(undefined, false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Bitte zuerst anmelden." });
    expect(fetchBfgDecisions).not.toHaveBeenCalled();
  });

  it("returns a service error when authentication is not configured", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValueOnce(null);

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(fetchBfgDecisions).not.toHaveBeenCalled();
  });

  it.each([
    ["missing query", "?page=1&size=10"],
    ["blank query", "?q=%20&page=1&size=10"],
    ["long query", `?q=${"x".repeat(MAX_FINDOK_QUERY_CHARS + 1)}&page=1&size=10`],
    ["long raw query", `?q=x${"%20".repeat(MAX_FINDOK_QUERY_CHARS)}&page=1&size=10`],
    ["zero page", "?q=test&page=0&size=10"],
    ["decimal page", "?q=test&page=1.5&size=10"],
    ["large page size", `?q=test&page=1&size=${MAX_FINDOK_PAGE_SIZE + 1}`],
    ["duplicate query", "?q=one&q=two&page=1&size=10"],
    ["user-provided URL", "?q=test&page=1&size=10&url=https%3A%2F%2Fevil.example"],
  ])("rejects bounded query validation: %s", async (_label, search) => {
    const response = await GET(request(search));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Die Findok-Anfrage ist ungültig." });
    expect(fetchBfgDecisions).not.toHaveBeenCalled();
  });

  it("returns compact JSON for an authenticated valid request", async () => {
    const payload = { ...successPayload, page: 2, pageSize: 5, totalPages: 3, totalCount: 11 };
    vi.mocked(fetchBfgDecisions).mockResolvedValueOnce(payload);
    const incoming = request("?q=%20Umsatzsteuer%20&page=2&size=5");

    const response = await GET(incoming);

    expect(response.status).toBe(200);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(incoming, expect.anything());
    expect(fetchBfgDecisions).toHaveBeenCalledWith({
      query: "Umsatzsteuer",
      page: 2,
      pageSize: 5,
    });
    await expect(response.json()).resolves.toEqual(payload);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps Findok failures to a concise upstream error", async () => {
    vi.mocked(fetchBfgDecisions).mockRejectedValueOnce(new FindokUpstreamError("private details"));

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Findok ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
    });
  });
});
