import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FINDOG_AGENT_CREDENTIALS_ENV, encryptFindogAgentSecret } from "@/lib/findog-agent/credentials";
import { FindogAgentStoreError } from "@/lib/findog-agent/store";
import { findogAgentTestSettings } from "@/lib/findog-agent/testing";
import type { FindogAgentTransportRequest } from "@/lib/findog-agent/network";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/findog-agent/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/findog-agent/store")>(
    "@/lib/findog-agent/store",
  );
  return {
    FindogAgentStoreError: actual.FindogAgentStoreError,
    createFindogAgentStore: vi.fn(),
  };
});

const upstreamRequests: FindogAgentTransportRequest[] = [];
vi.mock("@/lib/findog-agent/network", async () => {
  const actual = await vi.importActual<typeof import("@/lib/findog-agent/network")>(
    "@/lib/findog-agent/network",
  );
  return {
    ...actual,
    createFindogAgentHttpTransport: () => ({
      async send(request: FindogAgentTransportRequest) {
        upstreamRequests.push(request);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "chatcmpl-test",
            choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
          }),
          truncated: false,
        };
      },
    }),
  };
});

import { createFindogAgentStore } from "@/lib/findog-agent/store";
import { POST } from "./route";

type MockStore = {
  getSettingsSnapshotByRevision: ReturnType<typeof vi.fn>;
};

let store: MockStore;

function settingsSnapshot() {
  return {
    revision: 9,
    updatedAt: "2026-09-10T20:00:00.000Z",
    settings: findogAgentTestSettings(),
    encryptedCredentials: {
      "connection:primary:apiKey": encryptFindogAgentSecret("test-model-key"),
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("https://findog.at/api/admin/findog-agent/connection-tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("findog agent connection test route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    upstreamRequests.length = 0;
    process.env[FINDOG_AGENT_CREDENTIALS_ENV] = Buffer.alloc(32, 3).toString("base64");
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
    vi.mocked(isAdminUser).mockResolvedValue(true);
    store = { getSettingsSnapshotByRevision: vi.fn().mockResolvedValue(settingsSnapshot()) };
    vi.mocked(createFindogAgentStore).mockReturnValue(store as never);
  });

  afterEach(() => {
    delete process.env[FINDOG_AGENT_CREDENTIALS_ENV];
  });

  it("requires an administrator and makes no external call for a non-admin", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await POST(jsonRequest({ revision: 9, kind: "model", id: "flash" }));
    expect(response.status).toBe(403);
    expect(upstreamRequests).toHaveLength(0);
  });

  it("runs a deliberate model test and returns only allowlisted fields", async () => {
    const response = await POST(jsonRequest({ revision: 9, kind: "model", id: "flash" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, kind: "model", id: "flash", code: null });
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    // No credential material or raw provider payload is serialized.
    expect(JSON.stringify(body)).not.toContain("test-model-key");
    expect(JSON.stringify(body)).not.toContain("v1.");
  });

  it("rejects malformed bodies and unknown fields without any call", async () => {
    for (const body of [
      { revision: "9", kind: "model", id: "flash" },
      { revision: 9, kind: "shell", id: "flash" },
      { revision: 9, kind: "model" },
      { revision: 9, kind: "model", id: "flash", url: "https://evil.example.com" },
    ]) {
      const response = await POST(jsonRequest(body));
      expect(response.status).toBe(400);
    }
    expect(upstreamRequests).toHaveLength(0);
  });

  it("reports an unknown revision as not found", async () => {
    store.getSettingsSnapshotByRevision.mockRejectedValueOnce(new FindogAgentStoreError("not_found"));
    const response = await POST(jsonRequest({ revision: 999, kind: "model", id: "flash" }));
    expect(response.status).toBe(404);
    expect(upstreamRequests).toHaveLength(0);
  });

  it("rejects a missing bearer token", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const response = await POST(jsonRequest({ revision: 9, kind: "model", id: "flash" }));
    expect(response.status).toBe(401);
    expect(upstreamRequests).toHaveLength(0);
  });

  it("fails with 503 when Supabase is not configured", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    const response = await POST(jsonRequest({ revision: 9, kind: "model", id: "flash" }));
    expect(response.status).toBe(503);
  });
});
