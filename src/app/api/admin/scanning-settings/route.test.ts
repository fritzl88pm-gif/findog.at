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
    isValidDocumentPipeline: actual.isValidDocumentPipeline,
    isValidFredAttachmentMode: actual.isValidFredAttachmentMode,
    isValidModelId: actual.isValidModelId,
    isValidScanningProvider: actual.isValidScanningProvider,
  };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function putRequest(body: unknown): Request {
  return new Request("https://findog.at/api/admin/scanning-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Admin scanning-settings API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_omniroute_luna_fallback",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
      modelId: "google/gemini-3.5-flash",
      prompt: "Current scanning prompt",
      updatedAt: "2026-07-19T08:00:00.000Z",
      updatedBy: null,
    });
  });

  it("returns exactly the scanning fields and existing metadata", async () => {
    const response = await GET(new Request("https://findog.at/api/admin/scanning-settings"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      documentPipeline: "mineru_with_omniroute_luna_fallback",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
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

  it("updates document pipeline, model and prompt", async () => {
    vi.mocked(updateScanningSettings).mockResolvedValue({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "omniroute_luna",
      modelId: "anthropic/claude-sonnet-4-20250514",
      prompt: "New scanning prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: "admin-1",
    });

    const response = await PUT(putRequest({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "omniroute_luna",
      modelId: "anthropic/claude-sonnet-4-20250514",
      prompt: "New scanning prompt",
    }));

    expect(response.status).toBe(200);
    expect(updateScanningSettings).toHaveBeenCalledWith(
      expect.anything(),
      "admin-1",
      "anthropic/claude-sonnet-4-20250514",
      "New scanning prompt",
      "omniroute_luna_only",
      "weknora_native",
      "omniroute_luna",
    );
    await expect(response.json()).resolves.toEqual({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "omniroute_luna",
      modelId: "anthropic/claude-sonnet-4-20250514",
      prompt: "New scanning prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: "admin-1",
    });
  });

  it("rejects PUT without admin auth", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await PUT(putRequest({
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      prompt: "prompt",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
    }));
    expect(response.status).toBe(403);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["missing pipeline", { modelId: "model/x", fredAttachmentMode: "findog_preprocess", scanningProvider: "omniroute_luna", prompt: "prompt" }],
    ["missing model", { documentPipeline: "omniroute_luna_only", fredAttachmentMode: "findog_preprocess", scanningProvider: "omniroute_luna", prompt: "prompt" }],
    ["missing prompt", { documentPipeline: "omniroute_luna_only", modelId: "model/x", fredAttachmentMode: "findog_preprocess", scanningProvider: "omniroute_luna" }],
    ["extra field", {
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      prompt: "prompt",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
      extra: "field",
    }],
    ["invalid pipeline", { documentPipeline: "local_ocr", fredAttachmentMode: "findog_preprocess", scanningProvider: "omniroute_luna", modelId: "model/x", prompt: "prompt" }],
    ["invalid model", { documentPipeline: "omniroute_luna_only", modelId: "invalid model", fredAttachmentMode: "findog_preprocess", scanningProvider: "omniroute_luna", prompt: "prompt" }],
    ["empty prompt", { documentPipeline: "omniroute_luna_only", modelId: "model/x", fredAttachmentMode: "findog_preprocess", scanningProvider: "omniroute_luna", prompt: "" }],
    ["oversized prompt", {
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
      prompt: "x".repeat(40_001),
    }],
  ])("rejects PUT with %s", async (_label, body) => {
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with an invalid Fred attachment mode", async () => {
    const response = await PUT(putRequest({
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      prompt: "prompt",
      fredAttachmentMode: "browser_choice",
      scanningProvider: "omniroute_luna",
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with a missing Fred attachment mode", async () => {
    const response = await PUT(putRequest({
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      prompt: "prompt",
      scanningProvider: "omniroute_luna",
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with a missing scanning provider", async () => {
    const response = await PUT(putRequest({
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      prompt: "prompt",
      fredAttachmentMode: "findog_preprocess",
    }));
    expect(response.status).toBe(400);
    expect(updateScanningSettings).not.toHaveBeenCalled();
  });

  it("rejects PUT with an invalid scanning provider", async () => {
    const response = await PUT(putRequest({
      documentPipeline: "omniroute_luna_only",
      modelId: "model/x",
      prompt: "prompt",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "browser_choice",
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
});
