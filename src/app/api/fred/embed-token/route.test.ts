import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  mintFredEmbedSession,
} from "@/lib/weknora/fred-embed";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-embed")>();
  return { ...original, mintFredEmbedSession: vi.fn() };
});

let requestNumber = 0;

function request(options: { fetchSite?: string; ip?: string } = {}): Request {
  requestNumber += 1;
  const headers: Record<string, string> = {
    Authorization: "Bearer findog-access-token",
    "X-Forwarded-For": options.ip ?? `192.0.2.${requestNumber}`,
  };
  if (options.fetchSite) headers["Sec-Fetch-Site"] = options.fetchSite;
  return new Request("https://findog.at/api/fred/embed-token", { headers });
}

describe("GET /api/fred/embed-token", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: `user-${requestNumber}` });
    vi.mocked(mintFredEmbedSession).mockResolvedValue({
      token: "ems_session_token_fixture_123456",
      expiresIn: 1_800,
      channelId: "fred-channel-2026",
      embedOrigin: "https://taxdog.cloud",
    });
  });

  it("authenticates the Findog user before minting a WeKnora session", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const incoming = request();

    const response = await GET(incoming);

    expect(response.status).toBe(401);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(incoming, expect.anything());
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
  });

  it("does not contact WeKnora when server-side Supabase auth is unavailable", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValueOnce(null);

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
  });

  it("rejects cross-site browser calls to the token endpoint", async () => {
    const response = await GET(request({ fetchSite: "cross-site" }));

    expect(response.status).toBe(403);
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
  });

  it("returns only the short-lived session contract with private no-store headers", async () => {
    const incoming = request({ fetchSite: "same-origin" });

    const response = await GET(incoming);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe("Authorization");
    await expect(response.json()).resolves.toEqual({
      token: "ems_session_token_fixture_123456",
      expiresIn: 1_800,
      channelId: "fred-channel-2026",
      embedOrigin: "https://taxdog.cloud",
    });
    expect(mintFredEmbedSession).toHaveBeenCalledWith({ signal: incoming.signal });
  });

  it("maps missing Secure-Mode configuration without exposing secret material", async () => {
    vi.mocked(mintFredEmbedSession).mockRejectedValueOnce(new FredEmbedConfigurationError());

    const response = await GET(request());
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).toContain("noch nicht vollständig eingerichtet");
    expect(body).not.toContain("WEKNORA_FRED_PUBLISH_TOKEN");
    expect(body).not.toContain("em_");
  });

  it.each([
    ["rejected", 502],
    ["rate_limited", 503],
    ["unavailable", 502],
    ["invalid_response", 502],
  ] as const)("maps the upstream %s failure to a neutral response", async (kind, status) => {
    vi.mocked(mintFredEmbedSession).mockRejectedValueOnce(new FredEmbedUpstreamError(kind));

    const response = await GET(request());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: "Fred ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
    });
  });

  it("limits token minting by authenticated user even when forwarded IP values change", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "fred-rate-limit-user" });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await GET(request({ ip: `198.51.100.${attempt + 1}` }));
      expect(response.status).toBe(200);
    }

    const rejected = await GET(request({ ip: "203.0.113.200" }));
    expect(rejected.status).toBe(429);
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(12);
  });
});
