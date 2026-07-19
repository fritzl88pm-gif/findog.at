import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FindokUpstreamError } from "@/lib/findok/bfg-decisions";
import { BfgProModelError, runBfgProSearch } from "@/lib/findok/bfg-pro";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

const MAX_BFG_PRO_SCENARIO_CHARS = 2_000;

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/findok/bfg-pro", () => ({
  BfgProModelError: class BfgProModelError extends Error {},
  runBfgProSearch: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function request(body: BodyInit = JSON.stringify({ scenario: "Beruflich genutztes Arbeitszimmer" }), ip = "192.0.2.1") {
  return new Request("http://localhost/api/findok/bfg/pro", {
    method: "POST",
    headers: {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body,
  });
}

describe("POST /api/findok/bfg/pro", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(runBfgProSearch).mockResolvedValue({ results: [] });
  });

  it("requires Supabase bearer authentication before model or Findok work", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const incoming = request(undefined, "192.0.2.2");

    const response = await POST(incoming);

    expect(response.status).toBe(401);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(incoming, expect.anything());
    expect(runBfgProSearch).not.toHaveBeenCalled();
  });

  it("returns a service error when Supabase authentication is not configured", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValueOnce(null);

    const response = await POST(request(undefined, "192.0.2.3"));

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(runBfgProSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing scenario", JSON.stringify({})],
    ["blank scenario", JSON.stringify({ scenario: "  " })],
    ["non-string scenario", JSON.stringify({ scenario: 42 })],
    ["unknown model", JSON.stringify({ scenario: "Text", model: "deepseek-v4-pro" })],
    ["browser key", JSON.stringify({ scenario: "Text", apiKey: "secret" })],
    ["too long", JSON.stringify({ scenario: "x".repeat(MAX_BFG_PRO_SCENARIO_CHARS + 1) })],
    ["array", JSON.stringify([{ scenario: "Text" }])],
    ["malformed JSON", "{"],
  ])("rejects an invalid exact scenario body: %s", async (_label, body) => {
    const response = await POST(request(body, "198.51.100.1"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Die PRO-Suchanfrage ist ungültig." });
    expect(runBfgProSearch).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type", async () => {
    const incoming = new Request("http://localhost/api/findok/bfg/pro", {
      method: "POST",
      headers: { Authorization: "Bearer access-token", "Content-Type": "text/plain", "X-Forwarded-For": "192.0.2.4" },
      body: JSON.stringify({ scenario: "Text" }),
    });

    const response = await POST(incoming);

    expect(response.status).toBe(400);
    expect(runBfgProSearch).not.toHaveBeenCalled();
  });

  it("returns bounded no-store JSON for a valid scenario", async () => {
    const payload = { results: [{ title: "Entscheidung", caseSummary: "Sachverhalt und Ergebnis", whyRelevant: "Passend" }] } as never;
    vi.mocked(runBfgProSearch).mockResolvedValueOnce(payload);

    const response = await POST(request(undefined, "192.0.2.5"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runBfgProSearch).toHaveBeenCalledWith("Beruflich genutztes Arbeitszimmer");
    await expect(response.json()).resolves.toEqual(payload);
  });

  it("keeps an empty official or reranker result as a successful empty list", async () => {
    const response = await POST(request(undefined, "192.0.2.6"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results: [] });
  });

  it("maps Findok failures without upstream details", async () => {
    vi.mocked(runBfgProSearch).mockRejectedValueOnce(new FindokUpstreamError("private Findok body"));

    const response = await POST(request(undefined, "192.0.2.7"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Findok ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
    });
  });

  it("maps model parse/provider failures without provider details", async () => {
    vi.mocked(runBfgProSearch).mockRejectedValueOnce(new BfgProModelError("private provider body"));

    const response = await POST(request(undefined, "192.0.2.8"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Die KI-Reihung konnte nicht durchgeführt werden. Bitte erneut versuchen.",
    });
  });

  it("applies a route-local limit lower than normal chat", async () => {
    const ip = "203.0.113.77";
    for (let index = 0; index < 5; index += 1) {
      expect((await POST(request(undefined, ip))).status).toBe(200);
    }

    const limited = await POST(request(undefined, ip));

    expect(limited.status).toBe(429);
    expect(runBfgProSearch).toHaveBeenCalledTimes(5);
  });
});
