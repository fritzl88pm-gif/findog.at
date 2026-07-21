import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { UserVisibleError } from "../errors";
import {
  DASHBOARD_CACHE_TTL_MS,
  DASHBOARD_STALE_RETRY_MS,
  __resetWeKnoraDashboardCacheForTests,
  fetchWeKnoraDashboard,
  getWeKnoraDashboard,
  normalizeWeKnoraDashboard,
  parseMcpSseResponse,
} from "./dashboard";

const IDS = {
  wiki: "582f577a-ee1b-462d-ac55-636749320ae7",
  internal: "22dee3ae-2c61-438e-8609-f9e12144157e",
  fexklusiv: "7eac30a9-3add-4f84-bac2-4a3ae3c7c2c2",
  laws: "e0282ab8-b94f-4553-962e-68705201cf9a",
  forms: "d4cda9b9-23c6-4aa4-abae-9539146e227b",
  amounts: "442ad2e8-c69f-4cb5-985c-f3afadeb8645",
  winAnv: "952bd9ad-59a5-4ca4-ad28-3c945dab9515",
  bfg: "7e203a75-9e51-4839-afd4-7d24d2e5b033",
} as const;

function knowledgeBases(wikiCount = 129): Array<Record<string, unknown>> {
  return [
    { id: IDS.wiki, name: "private wiki name", knowledge_count: wikiCount, is_processing: false, processing_count: 0 },
    { id: IDS.internal, name: "private internal name", knowledge_count: 76, is_processing: false, processing_count: 0 },
    { id: IDS.fexklusiv, name: "private FEX name", knowledge_count: 25, is_processing: false, processing_count: 0 },
    { id: IDS.laws, name: "private law name", knowledge_count: 146, is_processing: false, processing_count: 0 },
    { id: IDS.forms, name: "private forms name", knowledge_count: 32, is_processing: false, processing_count: 0 },
    { id: IDS.amounts, name: "private amount name", knowledge_count: 0, is_processing: false, processing_count: 0 },
    { id: IDS.winAnv, name: "private Win ANV name", knowledge_count: 0, is_processing: false, processing_count: 0 },
    { id: IDS.bfg, name: "private BFG name", knowledge_count: 9_583, is_processing: false, processing_count: 0 },
  ];
}

const FAQ_TOTALS = {
  [IDS.amounts]: 794,
  [IDS.winAnv]: 1_276,
};

function rpcSse(id: number, toolPayload: unknown): Response {
  const nested = JSON.stringify(toolPayload);
  const rpc = JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: nested }],
      isError: false,
    },
  });
  return new Response(`event: message\ndata: ${rpc}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function queueSuccessfulSnapshot(fetchMock: ReturnType<typeof vi.fn>, wikiCount = 129): void {
  fetchMock
    .mockResolvedValueOnce(rpcSse(1, { success: true, data: knowledgeBases(wikiCount) }))
    .mockResolvedValueOnce(rpcSse(2, { success: true, data: { total: FAQ_TOTALS[IDS.amounts] } }))
    .mockResolvedValueOnce(rpcSse(3, { success: true, data: { total: FAQ_TOTALS[IDS.winAnv] } }));
}

describe("WeKnora dashboard normalization", () => {
  it("filters unknown KBs, preserves the approved public order, and uses type-specific counts", () => {
    const input = [
      { id: "unknown-private-kb", knowledge_count: 99_999, is_processing: true, processing_count: 42 },
      ...knowledgeBases().reverse(),
    ];

    const dashboard = normalizeWeKnoraDashboard(
      { success: true, data: input },
      FAQ_TOTALS,
      "2026-07-20T10:00:00.000Z",
    );

    expect(dashboard.knowledgeBases.map(({ id, name, kind, count }) => ({ id, name, kind, count }))).toEqual([
      { id: IDS.wiki, name: "Allgemeine Informationen Wiki", kind: "document", count: 129 },
      { id: IDS.internal, name: "Arbeitsbehelfe und interne Dokumente", kind: "document", count: 76 },
      { id: IDS.fexklusiv, name: "FEXklusiv", kind: "document", count: 25 },
      { id: IDS.laws, name: "Gesetze und Verordnungen", kind: "document", count: 146 },
      { id: IDS.forms, name: "Formulare", kind: "document", count: 32 },
      { id: IDS.amounts, name: "Betragstabelle FAQ", kind: "faq", count: 794 },
      { id: IDS.winAnv, name: "Win ANV", kind: "faq", count: 1_276 },
      { id: IDS.bfg, name: "BFG Entscheidungen Findok", kind: "document", count: 9_583 },
    ]);
    expect(dashboard.totals).toEqual({
      knowledgeBases: 8,
      documents: 9_991,
      faqEntries: 2_070,
      contents: 12_061,
      processing: 0,
    });
    const published = JSON.stringify(dashboard);
    expect(published).not.toContain("unknown-private-kb");
    expect(published).not.toContain("private ");
  });

  it("rejects malformed data, a missing required KB, a missing FAQ total, or a missing document count", () => {
    const fetchedAt = "2026-07-20T10:00:00.000Z";
    expect(() => normalizeWeKnoraDashboard(
      { success: true, data: knowledgeBases().filter((item) => item.id !== IDS.bfg) },
      FAQ_TOTALS,
      fetchedAt,
    )).toThrow(UserVisibleError);
    expect(() => normalizeWeKnoraDashboard(
      { success: true, data: knowledgeBases() },
      { [IDS.amounts]: 794 },
      fetchedAt,
    )).toThrow(UserVisibleError);
    expect(() => normalizeWeKnoraDashboard(
      { success: true, data: knowledgeBases().map((item) => item.id === IDS.wiki
        ? { ...item, knowledge_count: undefined }
        : item) },
      FAQ_TOTALS,
      fetchedAt,
    )).toThrow(UserVisibleError);
    expect(() => normalizeWeKnoraDashboard({ success: true, data: "partial" }, FAQ_TOTALS, fetchedAt))
      .toThrow(UserVisibleError);
  });
});

describe("WeKnora MCP transport", () => {
  it("parses only complete SSE data events with nested text JSON", () => {
    const response = `: keepalive\nevent: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { total: 794 } }) }] },
    })}\n\n`;
    expect(parseMcpSseResponse(response, 7)).toEqual({ success: true, data: { total: 794 } });
    expect(() => parseMcpSseResponse(JSON.stringify({ jsonrpc: "2.0", id: 7, result: {} }), 7))
      .toThrow(UserVisibleError);
    expect(() => parseMcpSseResponse("data: {\"jsonrpc\":\"2.0\",\"id\":7", 7))
      .toThrow(UserVisibleError);
  });

  it("sends one list call and two parallel FAQ calls with server bearer and MCP Accept headers", async () => {
    const fetchMock = vi.fn();
    queueSuccessfulSnapshot(fetchMock);

    const dashboard = await fetchWeKnoraDashboard({
      endpoint: "https://taxdog.cloud/mcp/bfg-query",
      token: "server-secret",
      fetchImpl: fetchMock as typeof fetch,
      now: () => Date.parse("2026-07-20T10:00:00.000Z"),
    });

    expect(dashboard.totals.contents).toBe(12_061);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as {
      params: { name: string; arguments: Record<string, unknown> };
    });
    expect(bodies.map((body) => body.params.name)).toEqual([
      "list_knowledge_bases",
      "faq_entries_search",
      "faq_entries_search",
    ]);
    expect(bodies.slice(1).map((body) => body.params.arguments)).toEqual([
      { kb_id: IDS.amounts, keyword: "", page: 1, page_size: 1 },
      { kb_id: IDS.winAnv, keyword: "", page: 1, page_size: 1 },
    ]);
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(call[0]).toBe("https://taxdog.cloud/mcp/bfg-query");
      expect(call[1]?.method).toBe("POST");
      expect(headers.get("authorization")).toBe("Bearer server-secret");
      expect(headers.get("accept")).toBe("application/json, text/event-stream");
      expect(headers.get("content-type")).toBe("application/json");
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("WeKnora dashboard cache", () => {
  beforeEach(() => {
    __resetWeKnoraDashboardCacheForTests();
    vi.stubEnv("WEKNORA_READONLY_MCP_BEARER_TOKEN", "cache-secret");
    vi.stubEnv("WEKNORA_READONLY_MCP_URL", "https://taxdog.cloud/mcp/bfg-query");
  });

  afterEach(() => {
    __resetWeKnoraDashboardCacheForTests();
    vi.unstubAllEnvs();
  });

  it("uses a 24-hour cache, single-flights cold loads, refreshes on expiry, and serves stale on refresh error", async () => {
    let now = Date.parse("2026-07-20T00:00:00.000Z");
    const fetchMock = vi.fn();
    queueSuccessfulSnapshot(fetchMock, 129);

    const [first, concurrent] = await Promise.all([
      getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now }),
      getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now }),
    ]);
    expect(first).toEqual(concurrent);
    expect(first.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now += DASHBOARD_CACHE_TTL_MS - 1;
    const cached = await getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now });
    expect(cached.fetchedAt).toBe(first.fetchedAt);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now += 1;
    queueSuccessfulSnapshot(fetchMock, 130);
    const refreshed = await getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now });
    expect(refreshed.totals.documents).toBe(9_992);
    expect(refreshed.fetchedAt).not.toBe(first.fetchedAt);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    now += DASHBOARD_CACHE_TTL_MS;
    fetchMock.mockRejectedValueOnce(new Error("raw upstream detail must stay private"));
    const stale = await getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now });
    expect(stale.stale).toBe(true);
    expect(stale.totals.documents).toBe(9_992);
    expect(JSON.stringify(stale)).not.toContain("raw upstream detail");
    expect(fetchMock).toHaveBeenCalledTimes(7);

    now += DASHBOARD_STALE_RETRY_MS - 1;
    const cachedStale = await getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now });
    expect(cachedStale.stale).toBe(true);
    expect(cachedStale.fetchedAt).toBe(stale.fetchedAt);
    expect(fetchMock).toHaveBeenCalledTimes(7);

    now += 1;
    queueSuccessfulSnapshot(fetchMock, 131);
    const recovered = await getWeKnoraDashboard({ fetchImpl: fetchMock as typeof fetch, now: () => now });
    expect(recovered.stale).toBe(false);
    expect(recovered.totals.documents).toBe(9_993);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("rejects a missing or blank server token with a controlled 503", async () => {
    vi.stubEnv("WEKNORA_READONLY_MCP_BEARER_TOKEN", "   ");
    const error = await getWeKnoraDashboard({ fetchImpl: vi.fn() as typeof fetch }).catch((reason) => reason);
    expect(error).toBeInstanceOf(UserVisibleError);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error.message)).not.toContain("WEKNORA_READONLY_MCP_BEARER_TOKEN");
  });
});
