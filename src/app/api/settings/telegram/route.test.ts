import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteTelegramIntegration,
  getTelegramIntegration,
  registerTelegramIntegration,
  replaceTelegramBot,
} from "@/lib/telegram/settings";
import { DELETE, GET, POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/telegram/settings", () => ({
  getTelegramIntegration: vi.fn(),
  registerTelegramIntegration: vi.fn(),
  replaceTelegramBot: vi.fn(),
  deleteTelegramIntegration: vi.fn(),
}));

const ENV_KEY = randomBytes(32).toString("base64");

function buildRequest(method: string, body?: unknown): Request {
  return new Request("https://findog.at/api/settings/telegram", {
    method,
    headers: {
      "Authorization": "Bearer test-token",
      "Content-Type": body ? "application/json" : "text/plain",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/settings/telegram", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => { delete process.env.TELEGRAM_CREDENTIALS_KEY; });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const response = await GET(buildRequest("GET"));
    expect(response.status).toBe(401);
  });

  it("returns 404 when no integration exists", async () => {
    vi.mocked(getTelegramIntegration).mockResolvedValue(null);
    const response = await GET(buildRequest("GET"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.integration).toBeNull();
  });

  it("returns integration data when found", async () => {
    vi.mocked(getTelegramIntegration).mockResolvedValue({ id: "int-1", status: "active", botUsername: "test_bot", pairingExpiresAt: null, hasActivePairing: false, hasPairedChat: true, lastErrorCode: null, lastErrorDescription: null, lastErrorAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    const response = await GET(buildRequest("GET"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.integration.status).toBe("active");
  });
});

describe("POST /api/settings/telegram", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    process.env.TELEGRAM_PUBLIC_ORIGIN = "https://findog.at";
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => { delete process.env.TELEGRAM_CREDENTIALS_KEY; delete process.env.TELEGRAM_PUBLIC_ORIGIN; });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const response = await POST(buildRequest("POST", { token: "test" }));
    expect(response.status).toBe(401);
  });

  it("returns 400 when token is missing", async () => {
    const response = await POST(buildRequest("POST", {}));
    expect(response.status).toBe(400);
  });

  it("registers a new integration and returns pairing deep link", async () => {
    vi.mocked(registerTelegramIntegration).mockResolvedValue({ status: "awaiting_pairing", deepLink: "https://t.me/test_bot?start=abc123" });
    const response = await POST(buildRequest("POST", { token: "123:abc" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.integration.status).toBe("awaiting_pairing");
    expect(body.integration.deepLink).toBe("https://t.me/test_bot?start=abc123");
  });

  it("returns 409 when foreign webhook conflict", async () => {
    vi.mocked(registerTelegramIntegration).mockResolvedValue({ status: "awaiting_pairing", conflict: "foreign_webhook" });
    const response = await POST(buildRequest("POST", { token: "123:abc" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.conflict).toBe("foreign_webhook");
  });

  it("passes replaceExistingWebhook option", async () => {
    vi.mocked(registerTelegramIntegration).mockResolvedValue({ status: "awaiting_pairing", deepLink: "https://t.me/test_bot?start=abc123" });
    const response = await POST(buildRequest("POST", { token: "123:abc", replaceExistingWebhook: true }));
    expect(response.status).toBe(200);
    expect(vi.mocked(registerTelegramIntegration)).toHaveBeenCalledWith("user-1", "123:abc", undefined, { replaceExistingWebhook: true });
  });

  it("replaces an existing integration without exposing the token", async () => {
    vi.mocked(getTelegramIntegration).mockResolvedValue({
      id: "int-1",
      status: "active",
      botUsername: "old_bot",
      pairingExpiresAt: null,
      hasActivePairing: false,
      hasPairedChat: true,
      lastErrorCode: null,
      lastErrorDescription: null,
      lastErrorAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    vi.mocked(replaceTelegramBot).mockResolvedValue({
      status: "awaiting_pairing",
      deepLink: "https://t.me/new_bot?start=abc123",
      pairingExpiresAt: "2026-08-01T00:00:00Z",
    });

    const response = await POST(buildRequest("POST", { token: "123:secret" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(replaceTelegramBot).toHaveBeenCalledWith("user-1", "123:secret", undefined, {
      replaceExistingWebhook: false,
    });
    expect(registerTelegramIntegration).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("123:secret");
  });

  it("preserves replacement webhook-conflict confirmation", async () => {
    vi.mocked(getTelegramIntegration).mockResolvedValue({
      id: "int-1",
      status: "active",
      botUsername: "old_bot",
      pairingExpiresAt: null,
      hasActivePairing: false,
      hasPairedChat: true,
      lastErrorCode: null,
      lastErrorDescription: null,
      lastErrorAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    vi.mocked(replaceTelegramBot).mockResolvedValue({
      status: "awaiting_pairing",
      conflict: "foreign_webhook",
    });

    const response = await POST(buildRequest("POST", { token: "123:secret" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ conflict: "foreign_webhook" });
  });
});

describe("DELETE /api/settings/telegram", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => { delete process.env.TELEGRAM_CREDENTIALS_KEY; });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const response = await DELETE(buildRequest("DELETE"));
    expect(response.status).toBe(401);
  });

  it("deletes the integration and returns success", async () => {
    vi.mocked(deleteTelegramIntegration).mockResolvedValue({ deleted: true });
    const response = await DELETE(buildRequest("DELETE"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(true);
  });

  it("returns 502 when Telegram API fails during disconnect", async () => {
    vi.mocked(deleteTelegramIntegration).mockResolvedValue({ deleted: false, error: "Telegram nicht erreichbar" });
    const response = await DELETE(buildRequest("DELETE"));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.deleted).toBe(false);
  });
});
