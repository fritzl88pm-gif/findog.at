import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import * as bfgCitations from "@/lib/findok/bfg-citations";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET, linkNewsletterItems } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/findok/bfg-citations", () => ({
  extractBfgGzCandidates: vi.fn(),
  linkVerifiedBfgCitations: vi.fn(),
  verifyBfgCitations: vi.fn(),
}));

const mockExtract = vi.mocked(bfgCitations.extractBfgGzCandidates);
const mockLink = vi.mocked(bfgCitations.linkVerifiedBfgCitations);
const mockVerify = vi.mocked(bfgCitations.verifyBfgCitations);

function newsletterItem(contentMarkdown: string) {
  return {
    id: "9a3b2c1d-0000-4000-8000-000000000001",
    publicationDate: "2026-08-30",
    contentMarkdown,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

describe("linkNewsletterItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLink.mockImplementation((content: string) => content);
  });

  it("returns items unchanged when no BFG GZ candidates exist", async () => {
    mockExtract.mockReturnValue([]);
    const items = [newsletterItem("Kein Urteil im Text.")];

    const result = await linkNewsletterItems(items);

    expect(result).toEqual(items);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("links verified BFG citations as full-text URLs, like chat answers", async () => {
    mockExtract.mockReturnValue(["RV/1100222/2025", "RV/9999999/2020"]);
    mockVerify.mockResolvedValue({
      verified: [
        {
          gz: "RV/1100222/2025",
          title: "RV/1100222/2025",
          documentTitle: "Entscheidung",
          dokumentId: "dok-1",
          segmentId: "seg-1",
          indexName: "findok-bfg",
          fullTextUrl: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100222%2F2025",
          pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/1.pdf",
        },
      ],
      rejected: [{ status: "not_found", gz: "RV/9999999/2020", reason: "nicht gefunden" }],
    });
    mockLink.mockImplementation((content, verified, options) => {
      expect(verified).toHaveLength(1);
      expect(options?.target).toBe("fullText");
      return content.replace(verified[0]?.gz ?? "", `[${verified[0]?.gz}](${verified[0]?.fullTextUrl})`);
    });
    const items = [newsletterItem("Siehe RV/1100222/2025 und RV/9999999/2020.")];

    const result = await linkNewsletterItems(items);

    expect(mockVerify).toHaveBeenCalledWith(["RV/1100222/2025", "RV/9999999/2020"], expect.any(Function));
    expect(result[0]?.contentMarkdown).toContain(
      "[RV/1100222/2025](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100222%2F2025)",
    );
  });

  it("keeps items unchanged when no citation could be verified", async () => {
    mockExtract.mockReturnValue(["RV/9999999/2020"]);
    mockVerify.mockResolvedValue({ verified: [], rejected: [] });
    const items = [newsletterItem("Siehe RV/9999999/2020.")];

    const result = await linkNewsletterItems(items);

    expect(result).toEqual(items);
    expect(mockLink).not.toHaveBeenCalled();
  });
});

describe("GET /api/bfg-newsletters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExtract.mockReturnValue([]);
  });

  it("requires authentication before reading newsletters", async () => {
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));

    const response = await GET(new Request("https://findog.at/api/bfg-newsletters"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled();
  });

  it("queries active newsletters newest first", async () => {
    const query = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [], error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => query) } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1", email: "user@findog.at" });

    const response = await GET(new Request("https://findog.at/api/bfg-newsletters"));

    expect(response.status).toBe(200);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.order.mock.calls).toEqual([
      ["publication_date", { ascending: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("delivers raw markdown when citation verification fails", async () => {
    mockExtract.mockReturnValue(["RV/1100222/2025"]);
    mockVerify.mockRejectedValue(new Error("Findok nicht erreichbar"));
    const query = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [{
        id: "9a3b2c1d-0000-4000-8000-000000000001",
        publication_date: "2026-08-30",
        content_markdown: "Siehe RV/1100222/2025.",
        created_at: "2026-08-30T00:00:00.000Z",
        updated_at: "2026-08-30T00:00:00.000Z",
      }],
      error: null,
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => query) } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1", email: "user@findog.at" });

    const response = await GET(new Request("https://findog.at/api/bfg-newsletters"));
    const payload = await response.json() as { items: Array<{ contentMarkdown: string }> };

    expect(response.status).toBe(200);
    expect(payload.items[0]?.contentMarkdown).toBe("Siehe RV/1100222/2025.");
  });
});
