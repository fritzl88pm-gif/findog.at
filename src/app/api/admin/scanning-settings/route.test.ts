import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getScanningSettings, updateScanningSettings } from "@/lib/scanning/settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/scanning/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scanning/settings")>();
  return {
    getScanningSettings: vi.fn(),
    updateScanningSettings: vi.fn(),
    isValidModelId: actual.isValidModelId,
  };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("Admin scanning-settings API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    vi.mocked(getScanningSettings).mockResolvedValue({
      modelId: "google/gemini-3.5-flash",
      prompt: "Current scanning prompt",
      updatedAt: "2026-07-19T08:00:00.000Z",
      updatedBy: null,
    });
  });

  it("returns scanning settings with modelId and prompt", async () => {
    const response = await GET(new Request("https://findog.at/api/admin/scanning-settings"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      modelId: "google/gemini-3.5-flash",
      prompt: "Current scanning prompt",
      updatedAt: "2026-07-19T08:00:00.000Z",
      updatedBy: null,
    });
  });

  it("rejects GET without admin auth", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await GET(new Request("https://findog.at/api/admin/scanning-settings"));
    expect(response.status).toBe(403);
  });

  it("updates scanning settings with valid modelId and prompt", async () => {
    vi.mocked(updateScanningSettings).mockResolvedValue({
      modelId: "anthropic/claude-sonnet-4-20250514",
      prompt: "New scanning prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: "admin-1",
    });

    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "anthropic/claude-sonnet-4-20250514", prompt: "New scanning prompt" }),
    }));
    expect(response.status).toBe(200);
    expect(updateScanningSettings).toHaveBeenCalledWith(
      expect.anything(),
      "admin-1",
      "anthropic/claude-sonnet-4-20250514",
      "New scanning prompt",
    );
    await expect(response.json()).resolves.toEqual({
      modelId: "anthropic/claude-sonnet-4-20250514",
      prompt: "New scanning prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: "admin-1",
    });
  });

  it("rejects PUT without admin auth", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "model/x", prompt: "prompt" }),
    }));
    expect(response.status).toBe(403);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with missing fields", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "model/x" }),
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with extra fields", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "model/x", prompt: "prompt", extra: "field" }),
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with malformed JSON body", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with invalid model ID", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "invalid model", prompt: "prompt" }),
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with empty prompt", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/scanning-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "model/x", prompt: "" }),
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });
});
