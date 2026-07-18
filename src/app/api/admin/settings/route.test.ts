import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  getGlobalSystemPromptRecord,
  updateGlobalSystemPrompt,
} from "@/lib/global-system-prompt";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/global-system-prompt", () => ({
  getGlobalSystemPromptRecord: vi.fn(),
  updateGlobalSystemPrompt: vi.fn(),
}));
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

const record = {
  systemPrompt: "Globaler Prompt",
  updatedAt: "2026-07-18T08:00:00.000Z",
  updatedBy: "admin-1",
};

describe("/api/admin/settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
  });

  it.each(["GET", "PUT"] as const)("returns 401 for unauthenticated %s", async (method) => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const response = await (method === "GET"
      ? GET(request(method))
      : PUT(request(method, { systemPrompt: "Prompt" })));
    expect(response.status).toBe(401);
    expect(isAdminUser).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT"] as const)("returns 403 for non-admin %s", async (method) => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await (method === "GET"
      ? GET(request(method))
      : PUT(request(method, { systemPrompt: "Prompt" })));
    expect(response.status).toBe(403);
    expect(getGlobalSystemPromptRecord).not.toHaveBeenCalled();
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
  });

  it("returns the current prompt only to an administrator", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    vi.mocked(getGlobalSystemPromptRecord).mockResolvedValue(record);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(record);
  });

  it("saves an unlimited prompt without altering it", async () => {
    const longPrompt = `  ${"x".repeat(120_000)}\n`;
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    vi.mocked(updateGlobalSystemPrompt).mockResolvedValue({ ...record, systemPrompt: longPrompt });
    const response = await PUT(request("PUT", { systemPrompt: longPrompt }));
    expect(response.status).toBe(200);
    expect(updateGlobalSystemPrompt).toHaveBeenCalledWith(expect.anything(), "admin-1", longPrompt);
  });

  it("rejects extra mutation fields", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const response = await PUT(request("PUT", { systemPrompt: "Prompt", isAdmin: true }));
    expect(response.status).toBe(400);
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
  });
});
