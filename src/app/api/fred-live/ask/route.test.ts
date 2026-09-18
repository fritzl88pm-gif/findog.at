import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { askQuickFred } from "@/lib/fred-live/ask";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/admin-users", () => ({ authenticateAdminRequest: vi.fn() }));
vi.mock("@/lib/fred-live/ask", () => ({ askQuickFred: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const request = (body: unknown) => new Request("http://localhost/api/fred-live/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("/api/fred-live/ask", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin" } as never);
    vi.mocked(askQuickFred).mockResolvedValue({ answer: "Antwort", sources: [], upstreamSessionId: "s", elapsedMs: 12 });
  });
  it("rejects non-admins and invalid questions", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValue(new UserVisibleError("Nein", 403));
    expect((await POST(request({ question: "x" }))).status).toBe(403);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin" } as never);
    expect((await POST(request({ question: " " }))).status).toBe(400);
    expect((await POST(request({ question: "x".repeat(2_001) }))).status).toBe(400);
  });
  it("returns the ephemeral answer", async () => {
    const response = await POST(request({ question: "Frage" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ answer: "Antwort" });
  });
  it("maps timeout and missing configuration", async () => {
    vi.mocked(askQuickFred).mockRejectedValueOnce(new UserVisibleError("timeout", 504));
    expect((await POST(request({ question: "Frage" }))).status).toBe(504);
    vi.mocked(askQuickFred).mockRejectedValueOnce(new UserVisibleError("missing", 503));
    expect((await POST(request({ question: "Frage" }))).status).toBe(503);
  });
});
