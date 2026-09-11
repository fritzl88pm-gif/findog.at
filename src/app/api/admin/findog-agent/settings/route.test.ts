import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FindogAgentStoreError } from "@/lib/findog-agent/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, PUT } from "./route";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/findog-agent/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/findog-agent/store")>("@/lib/findog-agent/store");
  return {
    FindogAgentStoreError: actual.FindogAgentStoreError,
    createFindogAgentStore: vi.fn(),
  };
});

import { createFindogAgentStore } from "@/lib/findog-agent/store";

const STORED_SETTINGS = {
  schemaVersion: 1,
  agentName: "Findog Agent",
  systemPrompt: "Recherchiere.",
  enabled: false,
  activeModelId: null,
  connections: [{ id: "primary", name: "DeepSeek", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1" }],
  models: [],
  knowledge: { enabled: false, baseUrl: null, knowledgeBaseIds: [] },
  web: { mode: "off", allowedDomains: [], maxResults: 5, maxTextCharacters: 20000 },
  mcp: { servers: [] },
  limits: {
    requestTimeoutSeconds: 120,
    deadlineSeconds: 600,
    maxSteps: 12,
    maxToolCalls: 24,
    maxOutputTokens: 8192,
    estimatedCostLimitUsd: null,
  },
};

const ENCRYPTED = { "connection:primary:apiKey": "v1.aaaa.bbbb.cccc" };

type MockStore = {
  getSettings: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
};

let store: MockStore;

describe("findog agent settings route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FINDOG_AGENT_CREDENTIALS_KEY = Buffer.alloc(32, 9).toString("base64");
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    store = {
      getSettings: vi.fn().mockResolvedValue({
        revision: 7,
        updatedAt: "2026-09-10T20:00:00.000Z",
        settings: STORED_SETTINGS,
        encryptedCredentials: ENCRYPTED,
      }),
      updateSettings: vi.fn().mockResolvedValue({ revision: 8, createdAt: "2026-09-10T21:00:00.000Z" }),
    };
    vi.mocked(createFindogAgentStore).mockReturnValue(store as never);
  });

  afterEach(() => {
    delete process.env.FINDOG_AGENT_CREDENTIALS_KEY;
  });

  it("requires an administrator before any work", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await GET(new Request("https://findog.at/api/admin/findog-agent/settings"));
    expect(response.status).toBe(403);
    expect(store.getSettings).not.toHaveBeenCalled();
  });

  it("returns a secret-free, no-store settings payload", async () => {
    const response = await GET(new Request("https://findog.at/api/admin/findog-agent/settings"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("v1.");
    expect(serialized).not.toContain("encryptedCredentials");
    expect(body.revision).toBe(7);
    expect(body.settings.connections[0].apiKeyConfigured).toBe(true);
  });

  it("saves settings with an optimistic revision", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/findog-agent/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 7,
        settings: STORED_SETTINGS,
        secrets: { "connection:primary:apiKey": "sk-new" },
      }),
    }));
    expect(response.status).toBe(200);
    const call = vi.mocked(store.updateSettings).mock.calls[0][0];
    expect(call.expectedRevision).toBe(7);
    expect(call.createdBy).toBe("admin-1");
    const stored: string = call.encryptedCredentials["connection:primary:apiKey"];
    expect(stored).not.toContain("sk-new");
    expect(stored.startsWith("v1.")).toBe(true);
  });

  it("reports a settings revision conflict as 409", async () => {
    store.updateSettings.mockRejectedValueOnce(new FindogAgentStoreError("conflict", "kaputt"));
    const response = await PUT(new Request("https://findog.at/api/admin/findog-agent/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, settings: STORED_SETTINGS, secrets: {} }),
    }));
    expect(response.status).toBe(409);
  });

  it("rejects blank secrets instead of wiping them", async () => {
    const response = await PUT(new Request("https://findog.at/api/admin/findog-agent/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 7,
        settings: STORED_SETTINGS,
        secrets: { "connection:primary:apiKey": "   " },
      }),
    }));
    expect(response.status).toBe(400);
    expect(store.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies and unknown secret names", async () => {
    for (const body of [
      "not-json",
      JSON.stringify({ settings: STORED_SETTINGS }),
      JSON.stringify({ expectedRevision: "7", settings: STORED_SETTINGS, secrets: {} }),
      JSON.stringify({
        expectedRevision: 7,
        settings: { ...STORED_SETTINGS, apiKeyEnv: "HOME" },
        secrets: {},
      }),
      JSON.stringify({
        expectedRevision: 7,
        settings: STORED_SETTINGS,
        secrets: { "env:HOME": "x" },
      }),
    ]) {
      const response = await PUT(new Request("https://findog.at/api/admin/findog-agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      }));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(store.updateSettings).not.toHaveBeenCalled();
  });

  it("reports an unavailable server without leaking internals", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    const response = await GET(new Request("https://findog.at/api/admin/findog-agent/settings"));
    expect(response.status).toBe(503);
  });

  it("rejects a missing bearer token", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const response = await GET(new Request("https://findog.at/api/admin/findog-agent/settings"));
    expect(response.status).toBe(401);
    expect(store.getSettings).not.toHaveBeenCalled();
  });
});
