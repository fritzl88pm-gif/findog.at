import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE, GET, POST, PUT } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});

describe("platform updates only", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const input = {
    kind: "product", title: "Plattformupdate", summary: "Neue Funktion", status: "draft",
    pinned: false, publishedAt: null, sourceSystem: null, documentKind: null,
    sourceIdentifier: null, sourceUrl: null, documentDate: null, asOfDate: null,
  };
  const legacy = {
    ...input, kind: "legal", sourceSystem: "ris", documentKind: "norm",
    sourceIdentifier: "fixture-norm", sourceUrl: "https://www.ris.bka.gv.at/fixture",
    documentDate: "2026-08-01", asOfDate: "2026-09-06",
  };
  function request(method: string, body: unknown) {
    return new Request("https://findog.at/api/admin/dashboard-news", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  }
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" } as never);
  });

  it.each([POST, PUT])("rejects legal input before any database access", async (handler) => {
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
    const response = await handler(request(handler === POST ? "POST" : "PUT", handler === POST ? legacy : { id, ...legacy }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("nur Plattformupdates");
    expect(from).not.toHaveBeenCalled();
  });

  function filteredClient() {
    const rows = [{ id, kind: "legal", status: "draft", deleted_at: null }];
    const filters: Record<string, unknown> = {};
    const matching = () => rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value));
    const query = {
      select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return query; }),
      is: vi.fn((key: string, value: unknown) => { filters[key] = value; return query; }),
      limit: vi.fn(async () => ({ data: matching(), error: null })),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: matching()[0] ?? null, error: null })),
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => query) } as never);
    return query;
  }

  it("excludes existing legal news from the admin list", async () => {
    filteredClient();
    const response = await GET(new Request("https://findog.at/api/admin/dashboard-news"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it("does not convert an existing legal record into a platform update", async () => {
    const query = filteredClient();
    const response = await PUT(request("PUT", { id, ...input }));
    expect(response.status).toBe(404);
    expect(query.update).not.toHaveBeenCalled();
  });

  it("does not soft-delete an existing legal record", async () => {
    const query = filteredClient();
    const response = await DELETE(request("DELETE", { id }));
    expect(response.status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("kind", "product");
  });
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("/api/admin/dashboard-news authorization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 and does not query news for a non-admin user", async () => {
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
    vi.mocked(authenticateAdminRequest).mockRejectedValue(
      new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
    );

    const response = await GET(new Request("https://findog.at/api/admin/dashboard-news"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled();
  });
});
