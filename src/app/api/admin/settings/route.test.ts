import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGlobalSystemPrompt,
  isAdminUser,
  updateGlobalSystemPrompt,
} from "@/lib/admin-settings";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/admin-settings", () => ({
  getGlobalSystemPrompt: vi.fn(),
  isAdminUser: vi.fn(),
  updateGlobalSystemPrompt: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("http://localhost/api/admin/settings", {
    method,
    headers: {
      Authorization: "Bearer access-token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/admin/settings authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
  });

  it.each(["GET", "PUT"] as const)("returns 401 for unauthenticated %s", async (method) => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await (method === "GET" ? GET(request(method)) : PUT(request(method, {
      systemPrompt: "Prompt",
    })));

    expect(response.status).toBe(401);
    expect(isAdminUser).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT"] as const)("returns 403 for authenticated non-admin %s", async (method) => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(false);

    const response = await (method === "GET" ? GET(request(method)) : PUT(request(method, {
      systemPrompt: "Prompt",
    })));

    expect(response.status).toBe(403);
    expect(getGlobalSystemPrompt).not.toHaveBeenCalled();
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
  });
});

describe("/api/admin/settings admin access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
  });

  it("returns the current global prompt", async () => {
    vi.mocked(getGlobalSystemPrompt).mockResolvedValue("Globaler Prompt");

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ systemPrompt: "Globaler Prompt" });
  });

  it("updates the global prompt", async () => {
    vi.mocked(updateGlobalSystemPrompt).mockResolvedValue("Neuer Prompt");

    const response = await PUT(request("PUT", { systemPrompt: "Neuer Prompt" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ systemPrompt: "Neuer Prompt" });
    expect(updateGlobalSystemPrompt).toHaveBeenCalledWith(expect.anything(), "admin-1", "Neuer Prompt");
  });

  it("rejects extra mutation fields", async () => {
    const response = await PUT(request("PUT", { systemPrompt: "Prompt", isAdmin: true }));

    expect(response.status).toBe(400);
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
  });
});
