import { describe, expect, it, vi } from "vitest";

import {
  detectExactFindokGz,
  fetchBfgDecisions,
  normalizeFindokQuery,
  parseFindokSseData,
} from "./bfg-decisions";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(value: unknown): Response {
  return new Response(`: keepalive\r\nevent: result\r\ndata: ${JSON.stringify(value)}\r\n\r\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Findok BFG request normalization", () => {
  it("collapses whitespace and recognizes normalized RV/RM business numbers", () => {
    expect(normalizeFindokQuery("  umsatzsteuer\n  innergemeinschaftlich  ")).toBe(
      "umsatzsteuer innergemeinschaftlich",
    );
    expect(detectExactFindokGz("  rv / 7100930 / 2024  ")).toBe("RV/7100930/2024");
    expect(detectExactFindokGz("Rm / 5100001 / 2023")).toBe("RM/5100001/2023");
  });

  it.each([
    "RV/2024",
    "RV//2024",
    "XX/7100930/2024",
    "Urteil RV/7100930/2024",
    "RV/7100930/24",
  ])("does not treat non-exact input as a direct GZ lookup: %s", (query) => {
    expect(detectExactFindokGz(query)).toBeNull();
  });
});

describe("Findok SSE parsing", () => {
  it("parses the first data event across CRLF framing and ignores comments", () => {
    expect(parseFindokSseData(": hello\r\nevent: search\r\ndata: {\"ok\":true}\r\n\r\ndata: [DONE]\r\n\r\n"))
      .toEqual({ ok: true });
  });

  it("reports malformed or missing data events", () => {
    expect(() => parseFindokSseData("event: result\n\n")).toThrow("Findok");
    expect(() => parseFindokSseData("data: {not-json}\n\n")).toThrow("Findok");
  });
});

describe("Findok BFG result mapping", () => {
  it.each([
    { requestedPage: 1, upstreamPage: 0, expectedPage: 1 },
    { requestedPage: 2, upstreamPage: 1, expectedPage: 2 },
  ])(
    "maps zero-based upstream page $upstreamPage to UI page $expectedPage",
    async ({ requestedPage, upstreamPage, expectedPage }) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(sseResponse({
        pageResults: {
          searchResults: [],
          currentPage: upstreamPage,
          pageSize: 10,
          totalPages: 3,
          totalSize: 21,
        },
      }));

      const result = await fetchBfgDecisions({
        query: "Umsatzsteuer",
        page: requestedPage,
        pageSize: 10,
        fetchImpl: fetchMock,
      });

      expect(result.page).toBe(expectedPage);
    },
  );

  it("uses the fixed search request, enriches every displayed hit, filters non-BFG details, and maps pagination", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse({
        pageResults: {
          searchResults: [
            {
              dokumentId: "doc 1&x",
              segmentId: "seg/1",
              indexName: "findok?index",
              title: "Search title",
              dokumenttyp: "Entscheidung",
              snippet: "Zur <em>Umsatzsteuer</em> &amp; Bemessung",
            },
            {
              dokumentId: "doc-2",
              segmentId: "seg-2",
              indexName: "findok",
              title: "Not a BFG detail",
              dokumenttyp: "Entscheidung",
              snippet: "ignored",
            },
          ],
          currentPage: 1,
          pageSize: 2,
          totalPages: 7,
          totalSize: 13,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        bfg: true,
        dokumentTitel: {
          titel: "BFG vom 10.07.2026",
          geschaeftszahl: "RV/7100930/2024",
        },
        dokumentPdfMediaUrl: "/findok/resources/pdf/entscheidung.pdf",
        zusatzinformationen: { inFindokVeroeffentlichtAm: "2026-07-10" },
        content: "Volltext",
      }))
      .mockResolvedValueOnce(jsonResponse({
        bfg: false,
        dokumentTitel: { titel: "Other court" },
        dokumentPdfMediaUrl: "//evil.example/other.pdf",
      }));

    const result = await fetchBfgDecisions({
      query: "  Umsatzsteuer  ",
      page: 2,
      pageSize: 2,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const searchUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${searchUrl.origin}${searchUrl.pathname}`).toBe("https://findok.bmf.gv.at/findok/api/dokumente");
    expect(Object.fromEntries(searchUrl.searchParams)).toEqual({
      page: "2",
      size: "2",
      suchbegriff: "Umsatzsteuer",
      typen: "BFG",
      "sort.value": "1",
    });
    expect(fetchMock.mock.calls.slice(1).map(([url]) => new URL(String(url)).origin))
      .toEqual(["https://findok.bmf.gv.at", "https://findok.bmf.gv.at"]);
    expect(result).toEqual({
      results: [{
        title: "BFG vom 10.07.2026",
        gz: "RV/7100930/2024",
        documentType: "Entscheidung",
        publicationDate: "2026-07-10",
        snippet: "Zur Umsatzsteuer & Bemessung",
        htmlUrl: "https://findok.bmf.gv.at/findok/volltext?dokumentId=doc+1%26x&segmentId=seg%2F1&indexName=findok%3Findex",
        pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/entscheidung.pdf",
      }],
      page: 2,
      pageSize: 2,
      totalPages: 7,
      totalCount: 13,
    });
  });

  it("uses the exact GZ endpoint instead of search and never guesses a PDF URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      bfg: true,
      dokumentTitel: {
        titel: "BFG-Entscheidung",
        geschaeftszahl: "RV/7100930/2024",
      },
      dokumenttyp: "Erkenntnis",
      dokumentPdfMediaUrl: null,
      zusatzinformationen: { inFindokVeroeffentlichtAm: "11.07.2026" },
      content: "Neutraler Volltext",
    }));

    const result = await fetchBfgDecisions({
      query: " rv / 7100930 / 2024 ",
      page: 9,
      pageSize: 20,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://findok.bmf.gv.at/findok/api/volltext/gz",
    );
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ gz: "RV/7100930/2024" });
    expect(result).toEqual({
      results: [{
        title: "BFG-Entscheidung",
        gz: "RV/7100930/2024",
        documentType: "Erkenntnis",
        publicationDate: "11.07.2026",
        snippet: "Neutraler Volltext",
        htmlUrl: null,
        pdfUrl: null,
      }],
      page: 1,
      pageSize: 20,
      totalPages: 1,
      totalCount: 1,
    });
  });

  it("drops unsafe PDF origins supplied by upstream data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      bfg: true,
      dokumentId: "doc",
      segmentId: "seg",
      indexName: "idx",
      dokumentTitel: { titel: "BFG", geschaeftszahl: "RM/1/2026" },
      dokumentPdfMediaUrl: "https://evil.example/decision.pdf",
    }));

    const result = await fetchBfgDecisions({
      query: "RM/1/2026",
      page: 1,
      pageSize: 10,
      fetchImpl: fetchMock,
    });

    expect(result.results[0]?.pdfUrl).toBeNull();
    expect(result.results[0]?.htmlUrl).toBe(
      "https://findok.bmf.gv.at/findok/volltext?dokumentId=doc&segmentId=seg&indexName=idx",
    );
  });
});
