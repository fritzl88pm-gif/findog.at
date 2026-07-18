import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  getGlobalSystemPromptRecord,
  updateGlobalSystemPrompt,
} from "@/lib/global-system-prompt";
import {
  getResearchResultLimit,
  updateResearchResultLimit,
} from "@/lib/research-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/global-system-prompt", () => ({
  getGlobalSystemPromptRecord: vi.fn(),
  updateGlobalSystemPrompt: vi.fn(),
}));
vi.mock("@/lib/research-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research-settings")>();
  return {
    ...actual,
    getResearchResultLimit: vi.fn(),
    updateResearchResultLimit: vi.fn(),
  };
});
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

const settingsPayload = { ...record, researchResultLimit: 8 };

describe("/api/admin/settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(getGlobalSystemPromptRecord).mockResolvedValue(record);
    vi.mocked(getResearchResultLimit).mockResolvedValue(8);
    vi.mocked(updateGlobalSystemPrompt).mockResolvedValue(record);
    vi.mocked(updateResearchResultLimit).mockResolvedValue(8);
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
    expect(updateResearchResultLimit).not.toHaveBeenCalled();
  });

  it("returns the current prompt and result limit only to an administrator", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(settingsPayload);
  });

  it("saves an unlimited prompt without altering it", async () => {
    const longPrompt = `  ${"x".repeat(120_000)}\n`;
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const response = await PUT(request("PUT", { systemPrompt: longPrompt }));
    expect(response.status).toBe(200);
    expect(updateGlobalSystemPrompt).toHaveBeenCalledWith(expect.anything(), "admin-1", longPrompt);
    expect(updateResearchResultLimit).not.toHaveBeenCalled();
  });

  it("saves the research result limit", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    vi.mocked(getResearchResultLimit).mockResolvedValue(12);
    const response = await PUT(request("PUT", { researchResultLimit: 12 }));
    expect(response.status).toBe(200);
    expect(updateResearchResultLimit).toHaveBeenCalledWith(expect.anything(), "admin-1", 12);
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ researchResultLimit: 12 });
  });

  it("updates both settings in a single request", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const response = await PUT(request("PUT", { systemPrompt: "Neu", researchResultLimit: 20 }));
    expect(response.status).toBe(200);
    expect(updateGlobalSystemPrompt).toHaveBeenCalledWith(expect.anything(), "admin-1", "Neu");
    expect(updateResearchResultLimit).toHaveBeenCalledWith(expect.anything(), "admin-1", 20);
  });

  it.each([0, 51, 2.5, "abc"])(
    "rejects an out-of-range result limit without writing: %s",
    async (value) => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
      vi.mocked(isAdminUser).mockResolvedValue(true);
      const response = await PUT(request("PUT", { researchResultLimit: value }));
      expect(response.status).toBe(400);
      expect(updateResearchResultLimit).not.toHaveBeenCalled();
      expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty settings body", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const response = await PUT(request("PUT", {}));
    expect(response.status).toBe(400);
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
    expect(updateResearchResultLimit).not.toHaveBeenCalled();
  });

  it("rejects extra mutation fields", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const response = await PUT(request("PUT", { systemPrompt: "Prompt", isAdmin: true }));
    expect(response.status).toBe(400);
    expect(updateGlobalSystemPrompt).not.toHaveBeenCalled();
    expect(updateResearchResultLimit).not.toHaveBeenCalled();
  });
});
