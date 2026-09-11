import { describe, expect, it } from "vitest";

import {
  createFindogAgentMockTransport,
  findogAgentJsonResponse,
  type FindogAgentMockRoute,
} from "../testing";
import { createFindogAgentExaAdapter } from "./exa";

function build(routes: FindogAgentMockRoute[], allowedDomains: string[] = ["example.com"]) {
  const http = createFindogAgentMockTransport(routes);
  const adapter = createFindogAgentExaAdapter({
    apiKey: "exa-key",
    transport: http.transport,
    timeoutMs: 5000,
    maxTextCharacters: 300,
    allowedDomains,
  });
  return { adapter, http };
}

function routeFor(path: string, payload: unknown): FindogAgentMockRoute {
  return {
    name: path,
    match: (request) => request.url.endsWith(path),
    handle: () => findogAgentJsonResponse(200, payload),
  };
}

describe("exa web adapter", () => {
  it("sends the fixed payload with the domain allowlist and filters the response again", async () => {
    const { adapter, http } = build([
      routeFor("/search", {
        costDollars: 0.007,
        results: [
          { id: "r1", title: "Erlaubt", url: "https://www.example.com/a", text: "Inhalt A" },
          { id: "r2", title: "Suffix-Angriff", url: "https://evil-example.com/b", text: "Inhalt B" },
          { id: "r3", title: "Beispiel-Subdomain", url: "https://docs.example.com/c", text: "Inhalt C" },
        ],
      }),
    ]);

    const result = await adapter.search({ query: "Findog", numResults: 5 });
    expect(result.hits.map((hit) => hit.url)).toEqual([
      "https://www.example.com/a",
      "https://docs.example.com/c",
    ]);
    expect(result.filtered).toBe(1);
    expect(result.costUsd).toBe(0.007);

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].url).toBe("https://api.exa.ai/search");
    expect(http.requests[0].headers["x-api-key"]).toBe("exa-key");
    expect(http.requests[0].json).toMatchObject({
      query: "Findog",
      type: "auto",
      numResults: 5,
      includeDomains: ["example.com"],
      contents: { text: { maxCharacters: 300 } },
    });
  });

  it("accepts open domains but still drops private and non-http results", async () => {
    const { adapter } = build([
      routeFor("/search", {
        results: [
          { title: "Lokal", url: "http://127.0.0.1/secrets", text: "x" },
          { title: "Datei", url: "file:///etc/passwd", text: "x" },
          { title: "Öffentlich", url: "https://open.example.org/page", text: "y" },
        ],
      }),
    ], []);

    const result = await adapter.search({ query: "offen", numResults: 3 });
    expect(result.hits.map((hit) => hit.url)).toEqual(["https://open.example.org/page"]);
    expect(result.filtered).toBe(2);
    expect(result.costUsd).toBeNull();
  });

  it("refuses a domain escape before any network call when reading pages", async () => {
    const { adapter, http } = build([routeFor("/contents", { results: [] })]);
    await expect(adapter.read({ urls: ["https://evil-example.com/page"] }))
      .rejects.toMatchObject({ code: "blocked_destination" });
    await expect(adapter.read({ urls: ["http://169.254.169.254/latest/meta-data/"] }))
      .rejects.toMatchObject({ code: "blocked_destination" });
    expect(http.requests).toHaveLength(0);
  });

  it("reads allowed pages through /contents and reports per-url failures", async () => {
    const { adapter, http } = build([
      routeFor("/contents", {
        costDollars: 0.002,
        results: [
          { id: "r1", title: "Seite", url: "https://example.com/page", text: "Seiteninhalt" },
        ],
        statuses: [
          { id: "https://example.com/page", status: "success" },
          { id: "https://example.com/missing", status: "error", error: "not found" },
        ],
      }),
    ]);

    const result = await adapter.read({
      urls: ["https://example.com/page", "https://example.com/missing", "https://example.com/page"],
    });
    expect(result.pages).toHaveLength(1);
    expect(result.errors).toEqual([{ url: "https://example.com/missing", reason: "not found" }]);
    expect(result.costUsd).toBe(0.002);
    expect(http.requests[0].json).toMatchObject({
      ids: ["https://example.com/page", "https://example.com/missing"],
    });
  });

  it("surfaces upstream errors instead of pretending there were no results", async () => {
    const { adapter } = build([{
      name: "search",
      match: () => true,
      handle: () => findogAgentJsonResponse(429, { error: "rate limited" }),
    }]);
    await expect(adapter.search({ query: "x", numResults: 1 }))
      .rejects.toMatchObject({ code: "upstream_error", status: 429 });

    const broken = build([{
      name: "search",
      match: () => true,
      handle: () => findogAgentJsonResponse(200, "{not json"),
    }]).adapter;
    await expect(broken.search({ query: "x", numResults: 1 }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});
