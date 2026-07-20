import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getWeKnoraDashboard } from "@/lib/weknora/dashboard";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/dashboard", () => ({ getWeKnoraDashboard: vi.fn() }));

const fixture = {
  knowledgeBases: [],
  totals: { knowledgeBases: 7, contents: 12_029, documents: 9_959, faqEntries: 2_070, processing: 0 },
  fetchedAt: "2026-07-20T10:00:00.000Z",
  stale: false,
};

describe("GET /api/weknora-data", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "normal-user", email: "user@example.at" });
    vi.mocked(getWeKnoraDashboard).mockResolvedValue(fixture);
  });

  it("rejects unauthenticated requests and does not load WeKnora data", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const response = await GET(new Request("https://findog.at/api/weknora-data"));

    expect(response.status).toBe(401);
    expect(getWeKnoraDashboard).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("permits a normal authenticated non-admin user and sets no-store", async () => {
    const request = new Request("https://findog.at/api/weknora-data", {
      headers: { Authorization: "Bearer user-token" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fixture);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, expect.anything());
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
  });
});
