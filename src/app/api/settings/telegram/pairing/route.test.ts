import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { rotatePairingToken } from "@/lib/telegram/settings";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/telegram/settings", () => ({ rotatePairingToken: vi.fn() }));

const ENV_KEY = randomBytes(32).toString("base64");

function buildRequest(): Request {
  return new Request("https://findog.at/api/settings/telegram/pairing", {
    method: "POST",
    headers: { "Authorization": "Bearer test-token" },
  });
}

describe("POST /api/settings/telegram/pairing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_CREDENTIALS_KEY = ENV_KEY;
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => { delete process.env.TELEGRAM_CREDENTIALS_KEY; });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
  });

  it("returns the new deep link on success", async () => {
    vi.mocked(rotatePairingToken).mockResolvedValue({
      deepLink: "https://t.me/test_bot?start=new-token",
      pairingExpiresAt: "2026-08-01T10:10:00.000Z",
    });
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deepLink).toBe("https://t.me/test_bot?start=new-token");
    expect(body.pairingExpiresAt).toBe("2026-08-01T10:10:00.000Z");
  });

  it("returns 404 when no integration exists", async () => {
    vi.mocked(rotatePairingToken).mockRejectedValue(new UserVisibleError("Keine Telegram-Integration gefunden.", 404));
    const response = await POST(buildRequest());
    expect(response.status).toBe(404);
  });

  it("returns 409 when pairing is already complete", async () => {
    vi.mocked(rotatePairingToken).mockRejectedValue(new UserVisibleError("Pairing ist bereits abgeschlossen.", 409));
    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
  });
});
