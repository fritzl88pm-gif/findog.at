import { describe, expect, it } from "vitest";

import { FindogAgentAdapterError } from "../errors";
import {
  createFindogAgentMockTransport,
  findogAgentJsonResponse,
  type FindogAgentMockRoute,
} from "../testing";
import { createFindogAgentKnowledgeAdapter, encodeFindogAgentSlug } from "./weknora";

const BASE_URL = "https://weknora.example.com/api/v1";

function build(routes: FindogAgentMockRoute[], overrides: Partial<Parameters<typeof createFindogAgentKnowledgeAdapter>[0]> = {}) {
  const http = createFindogAgentMockTransport(routes);
  const adapter = createFindogAgentKnowledgeAdapter({
    baseUrl: BASE_URL,
    apiKey: "wk-key",
    knowledgeBaseIds: ["kb-1"],
    transport: http.transport,
    timeoutMs: 5000,
    maxTextCharacters: 200,
    ...overrides,
  });
  return { adapter, http };
}

function searchRoute(payload: unknown): FindogAgentMockRoute {
  return {
    name: "search",
    match: (request) => request.url.endsWith("/knowledge-search"),
    handle: () => findogAgentJsonResponse(200, payload),
  };
}

function detailRoute(knowledgeId: string, knowledgeBaseId: string, title: string): FindogAgentMockRoute {
  return {
    name: "detail",
    match: (request) => request.url.includes("/knowledge/") && !request.url.includes("/chunks/"),
    handle: () => findogAgentJsonResponse(200, {
      success: true,
      data: { id: knowledgeId, knowledge_base_id: knowledgeBaseId, title },
    }),
  };
}

function pagedChunkRoute(options: {
  total: number;
  mutatePage?: (page: number) => unknown[] | null;
}): FindogAgentMockRoute {
  return {
    name: "chunks",
    match: (request) => request.url.includes("/chunks/"),
    handle: (request) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get("page") ?? "1");
      const size = Number(url.searchParams.get("page_size") ?? "10");
      const custom = options.mutatePage?.(page);
      if (custom) {
        return findogAgentJsonResponse(200, {
          success: true,
          page,
          page_size: size,
          total: options.total,
          data: custom,
        });
      }
      const start = (page - 1) * size;
      const length = Math.max(0, Math.min(size, options.total - start));
      const data = Array.from({ length }, (_, index) => ({
        id: `c${start + index}`,
        knowledge_id: "doc-1",
        knowledge_base_id: "kb-1",
        content: `Abschnitt ${start + index}`,
      }));
      return findogAgentJsonResponse(200, {
        success: true,
        page,
        page_size: size,
        total: options.total,
        data,
      });
    },
  };
}

describe("weknora knowledge adapter", () => {
  it("searches the configured knowledge bases with the documented payload", async () => {
    const { adapter, http } = build([searchRoute({
      success: true,
      data: [{
        id: "chunk-1",
        knowledge_id: "doc-1",
        knowledge_base_id: "kb-1",
        knowledge_title: "Satzung",
        content: "§ 1 Der Verein führt den Namen Findog.",
        score: 0.87,
      }],
    })]);

    const result = await adapter.search({ query: "Vereinsname", limit: 5 });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      knowledgeId: "doc-1",
      chunkId: "chunk-1",
      knowledgeBaseId: "kb-1",
      title: "Satzung",
      truncated: false,
    });
    expect(http.requests[0].json).toEqual({
      query: "Vereinsname",
      knowledge_base_ids: ["kb-1"],
    });
    expect(http.requests[0].headers["x-api-key"]).toBe("wk-key");
  });

  it("verifies a missing knowledge_base_id before trusting it and drops out-of-scope results", async () => {
    const routes: FindogAgentMockRoute[] = [
      searchRoute({
        success: true,
        data: [
          { id: "chunk-a", knowledge_id: "doc-verified", content: "Freigegebener Inhalt." },
          { id: "chunk-b", knowledge_id: "doc-foreign", content: "Fremder Inhalt." },
        ],
      }),
      {
        name: "detail",
        match: (request) => request.url.includes("/knowledge/"),
        handle: (request) => findogAgentJsonResponse(200, {
          success: true,
          data: request.url.endsWith("doc-verified")
            ? { id: "doc-verified", knowledge_base_id: "kb-1", title: "Freigegeben" }
            : { id: "doc-foreign", knowledge_base_id: "kb-other", title: "Fremd" },
        }),
      },
    ];
    const { adapter, http } = build(routes);

    const result = await adapter.search({ query: "Inhalt", limit: 5 });
    expect(result.hits.map((hit) => hit.knowledgeId)).toEqual(["doc-verified"]);
    expect(result.filtered).toBe(1);
    expect(http.requests.filter((request) => request.url.includes("/knowledge/doc-foreign"))).toHaveLength(1);
  });

  it("checks knowledge base membership before reading chunks", async () => {
    const { adapter, http } = build([{
      name: "detail",
      match: (request) => request.url.includes("/knowledge/"),
      handle: () => findogAgentJsonResponse(200, {
        success: true,
        data: { id: "doc-1", knowledge_base_id: "kb-other", title: "Fremd" },
      }),
    }]);

    await expect(adapter.readKnowledge({ knowledgeId: "doc-1" }))
      .rejects.toMatchObject({ code: "scope_denied" });
    expect(http.requests.filter((request) => request.url.includes("/chunks/"))).toHaveLength(0);
  });

  it("reads a scoped document and rejects cross-scope chunks", async () => {
    const routes: FindogAgentMockRoute[] = [
      {
        name: "detail",
        match: (request) => request.url.includes("/knowledge/"),
        handle: () => findogAgentJsonResponse(200, {
          success: true,
          data: { id: "doc-1", knowledge_base_id: "kb-1", title: "Satzung" },
        }),
      },
      {
        name: "chunks",
        match: (request) => request.url.includes("/chunks/"),
        handle: () => findogAgentJsonResponse(200, {
          success: true,
          data: [
            { id: "c1", knowledge_id: "doc-1", knowledge_base_id: "kb-1", content: "Erster Abschnitt.", chunk_index: 0 },
            { id: "c2", knowledge_id: "doc-1", knowledge_base_id: "kb-1", content: "Zweiter Abschnitt.", chunk_index: 1 },
          ],
        }),
      },
    ];
    const { adapter } = build(routes);
    const read = await adapter.readKnowledge({ knowledgeId: "doc-1" });
    expect(read.text).toBe("Erster Abschnitt.\n\nZweiter Abschnitt.");
    expect(read.chunksRead).toBe(2);
    expect(read.truncated).toBe(false);

    const leaky = build([
      routes[0],
      {
        name: "chunks",
        match: (request) => request.url.includes("/chunks/"),
        handle: () => findogAgentJsonResponse(200, {
          success: true,
          data: [{ id: "c1", knowledge_id: "doc-1", knowledge_base_id: "kb-foreign", content: "Fremd." }],
        }),
      },
    ]).adapter;
    await expect(leaky.readKnowledge({ knowledgeId: "doc-1" }))
      .rejects.toMatchObject({ code: "scope_denied" });
  });

  it("truncates oversized content and keeps an explicit marker", async () => {
    const { adapter } = build([
      searchRoute({
        success: true,
        data: [{
          id: "chunk-1",
          knowledge_id: "doc-1",
          knowledge_base_id: "kb-1",
          knowledge_title: "Lang",
          content: "x".repeat(1000),
        }],
      }),
    ]);
    const result = await adapter.search({ query: "lang", limit: 1 });
    expect(result.hits[0].truncated).toBe(true);
    expect(result.hits[0].text).toHaveLength(200);
  });

  it("turns upstream failures into explicit errors", async () => {
    const { adapter } = build([searchRoute({ success: false, message: "scope rejected" })]);
    await expect(adapter.search({ query: "x", limit: 1 }))
      .rejects.toMatchObject({ code: "upstream_error" });

    const failing = build([{
      name: "search",
      match: () => true,
      handle: () => findogAgentJsonResponse(500, { success: false }),
    }]).adapter;
    await expect(failing.search({ query: "x", limit: 1 }))
      .rejects.toMatchObject({ code: "upstream_error", status: 500 });

    const notFound = build([{
      name: "detail",
      match: () => true,
      handle: () => findogAgentJsonResponse(404, { success: false }),
    }]).adapter;
    await expect(notFound.readKnowledge({ knowledgeId: "doc-1" }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects wiki scope escapes, traversal slugs and incomplete base urls", async () => {
    const { adapter, http } = build([]);

    await expect(adapter.wikiRead({ knowledgeBaseId: "kb-other", slug: "concept/rag" }))
      .rejects.toMatchObject({ code: "scope_denied" });
    await expect(adapter.wikiRead({ knowledgeBaseId: "kb-1", slug: "../../etc/passwd" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(http.requests).toHaveLength(0);

    const unavailable = build([{
      name: "wiki",
      match: () => true,
      handle: () => findogAgentJsonResponse(404, { success: false, message: "kein Wiki" }),
    }]).adapter;
    await expect(unavailable.wikiSearch({ knowledgeBaseId: "kb-1", query: "x", limit: 5 }))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(unavailable.wikiRead({ knowledgeBaseId: "kb-1", slug: "concept/rag" }))
      .rejects.toMatchObject({ code: "unavailable" });

    expect(() => encodeFindogAgentSlug("a/../b")).toThrowError(FindogAgentAdapterError);
    expect(encodeFindogAgentSlug("concept/rag eins")).toBe("concept/rag%20eins");

    expect(() => createFindogAgentKnowledgeAdapter({
      baseUrl: "https://weknora.example.com",
      apiKey: "k",
      knowledgeBaseIds: ["kb-1"],
      transport: http.transport,
      timeoutMs: 1000,
      maxTextCharacters: 100,
    })).toThrowError(/api\/v1/);
  });

  it("reads wiki pages within the configured knowledge base", async () => {
    const { adapter, http } = build([{
      name: "wiki",
      match: (request) => request.url.includes("/wiki/pages/"),
      handle: () => findogAgentJsonResponse(200, {
        slug: "concept/rag",
        title: "RAG",
        page_type: "concept",
        content: "Retrieval Augmented Generation.",
      }),
    }]);
    const page = await adapter.wikiRead({ knowledgeBaseId: "kb-1", slug: "concept/rag" });
    expect(page.title).toBe("RAG");
    expect(page.text).toBe("Retrieval Augmented Generation.");
    expect(http.requests[0].url)
      .toBe(`${BASE_URL}/knowledgebase/kb-1/wiki/pages/concept/rag`);
  });
});

describe("weknora knowledge adapter - chunk pagination and continuation", () => {
  it("reads every page of a 20-chunk document instead of only page one", async () => {
    const { adapter, http } = build(
      [detailRoute("doc-1", "kb-1", "Langdokument"), pagedChunkRoute({ total: 20 })],
      { maxTextCharacters: 20000 },
    );

    const read = await adapter.readKnowledge({ knowledgeId: "doc-1" });

    expect(read.truncated).toBe(false);
    expect(read.totalChunks).toBe(20);
    expect(read.chunksRead).toBe(20);
    expect(read.nextChunk).toBeNull();
    for (let index = 0; index < 20; index += 1) {
      expect(read.text).toContain(`Abschnitt ${index}`);
    }
    const pages = http.requests
      .filter((request) => request.url.includes("/chunks/"))
      .map((request) => new URL(request.url).searchParams.get("page"));
    expect(pages).toEqual(["1", "2"]);
  });

  it("stops at the text cap, reports truncation and resumes without dropping chunks", async () => {
    const { adapter } = build(
      [detailRoute("doc-1", "kb-1", "Langdokument"), pagedChunkRoute({ total: 20 })],
      { maxTextCharacters: 90 },
    );

    const first = await adapter.readKnowledge({ knowledgeId: "doc-1" });
    expect(first.truncated).toBe(true);
    expect(first.nextChunk).not.toBeNull();
    expect(first.chunksRead).toBeLessThan(20);

    const seen = new Set<number>();
    const collect = (text: string) => {
      for (const match of text.matchAll(/Abschnitt (\d+)/g)) {
        seen.add(Number(match[1]));
      }
    };
    collect(first.text);
    let read = first;
    let guard = 0;
    while (read.truncated && read.nextChunk !== null) {
      guard += 1;
      expect(guard).toBeLessThan(40);
      read = await adapter.readKnowledge({ knowledgeId: "doc-1", startChunk: read.nextChunk });
      collect(read.text);
    }

    // No chunk is silently omitted: every chunk is reachable through the
    // bounded continuation chain.
    for (let index = 0; index < 20; index += 1) {
      expect(seen.has(index)).toBe(true);
    }
  });

  it("reports the exact mid-page continuation index, not just the next page", async () => {
    const { adapter } = build(
      [detailRoute("doc-1", "kb-1", "Langdokument"), pagedChunkRoute({ total: 30 })],
      { maxTextCharacters: 90 },
    );
    const first = await adapter.readKnowledge({ knowledgeId: "doc-1" });
    expect(first.totalChunks).toBe(30);
    // The cap allows chunks 0..6; the continuation points at the first unread
    // chunk (7) rather than at the start of the next page (10).
    expect(first.nextChunk).toBe(7);
  });

  it("rejects chunks of another document on a later page", async () => {
    const { adapter } = build(
      [
        detailRoute("doc-1", "kb-1", "Doc"),
        pagedChunkRoute({
          total: 20,
          mutatePage: (page) => (page === 2
            ? [{ id: "x", knowledge_id: "doc-other", knowledge_base_id: "kb-1", content: "Fremd." }]
            : null),
        }),
      ],
      { maxTextCharacters: 20000 },
    );

    await expect(adapter.readKnowledge({ knowledgeId: "doc-1" }))
      .rejects.toMatchObject({ code: "scope_denied" });
  });
});
