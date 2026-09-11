/**
 * WeKnora retrieval adapter (read-only).
 *
 * Only the documented REST routes are used: `/knowledge-search`,
 * `/knowledge/{id}`, `/chunks/{knowledge_id}`, `/knowledge-bases/{id}/knowledge`
 * and the wiki search/index/pages routes. No embed, no AgentQA, no session
 * creation and no writes.
 *
 * Every read is scoped: knowledge and chunk reads verify that the returned
 * document belongs to an administrator-selected knowledge base *before* any
 * content is trusted, and path parameters are encoded with traversal rejected.
 */

import { FindogAgentAdapterError } from "../errors";
import type { FindogAgentTransport, FindogAgentTransportResponse } from "../network";
import { boundFindogAgentText } from "../text";

export type FindogAgentKnowledgeAdapterOptions = {
  /** WeKnora base URL; must end with `/api/v1`. */
  baseUrl: string;
  apiKey: string;
  knowledgeBaseIds: string[];
  transport: FindogAgentTransport;
  timeoutMs: number;
  maxTextCharacters: number;
};

export type FindogAgentKnowledgeHit = {
  knowledgeId: string;
  chunkId: string | null;
  knowledgeBaseId: string;
  title: string;
  text: string;
  truncated: boolean;
  score: number | null;
  sourceUrl: string | null;
  filename: string | null;
};

export type FindogAgentKnowledgeSearchResult = {
  hits: FindogAgentKnowledgeHit[];
  /** Results dropped because their knowledge base is outside the configured scope. */
  filtered: number;
  notes: string[];
};

export type FindogAgentKnowledgeReadResult = {
  knowledgeId: string;
  knowledgeBaseId: string;
  title: string;
  text: string;
  truncated: boolean;
  chunksRead: number;
  /** Server-reported total chunk count, or null when the envelope omitted it. */
  totalChunks: number | null;
  /**
   * Bounded continuation: absolute 0-based index of the first chunk that was not
   * read, or null when the document was read completely. Pass it back as
   * `startChunk` to read on from exactly that point (no chunk is skipped).
   */
  nextChunk: number | null;
  sourceUrl: string | null;
};

export type FindogAgentWikiPageSummary = {
  slug: string;
  title: string;
  summary: string;
  pageType: string;
};

export type FindogAgentWikiReadResult = {
  slug: string;
  title: string;
  pageType: string;
  text: string;
  truncated: boolean;
};

export type FindogAgentKnowledgeBaseSummary = {
  id: string;
  name: string;
  /** True when the base is inside the administrator-configured scope. */
  configured: boolean;
};

export type FindogAgentKnowledgeAdapter = {
  knowledgeBaseIds: string[];
  /** Read-only discovery used by the explicit admin connection test, never by a run. */
  listKnowledgeBases(input?: {
    signal?: AbortSignal | null;
  }): Promise<FindogAgentKnowledgeBaseSummary[]>;
  search(input: {
    query: string;
    limit: number;
    signal?: AbortSignal | null;
  }): Promise<FindogAgentKnowledgeSearchResult>;
  readKnowledge(input: {
    knowledgeId: string;
    /** Absolute 0-based chunk index to start reading from (bounded continuation). */
    startChunk?: number;
    signal?: AbortSignal | null;
  }): Promise<FindogAgentKnowledgeReadResult>;
  wikiSearch(input: {
    knowledgeBaseId: string;
    query: string;
    limit: number;
    signal?: AbortSignal | null;
  }): Promise<FindogAgentWikiPageSummary[]>;
  wikiRead(input: {
    knowledgeBaseId: string;
    slug: string;
    signal?: AbortSignal | null;
  }): Promise<FindogAgentWikiReadResult>;
};

const MAX_SLUG_CHARACTERS = 200;
const CHUNK_PAGE_SIZE = 10;
/** Upper bound on the number of chunk pages a single read may fetch. */
const MAX_CHUNK_PAGES = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Accepts a number or a numeric string; used for pagination/total fields. */
function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

/** Rejects traversal and control characters, then encodes each path segment. */
export function encodeFindogAgentSlug(slug: unknown): string {
  if (typeof slug !== "string") {
    throw new FindogAgentAdapterError("invalid_request", "Der Wiki-Slug ist ungültig.");
  }
  const trimmed = slug.trim();
  if (
    !trimmed
    || trimmed.length > MAX_SLUG_CHARACTERS
    || trimmed.includes("..")
    || trimmed.startsWith("/")
    || trimmed.includes("\\")
    || trimmed.includes("?")
    || trimmed.includes("#")
    || /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new FindogAgentAdapterError(
      "invalid_request",
      "Der Wiki-Slug ist ungültig (Pfadwechsel sind nicht erlaubt).",
    );
  }
  return trimmed
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function encodePathSegment(value: string): string {
  if (!value || value.length > 200 || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new FindogAgentAdapterError("invalid_request", "Die angeforderte Kennung ist ungültig.");
  }
  return encodeURIComponent(value);
}

export function createFindogAgentKnowledgeAdapter(
  options: FindogAgentKnowledgeAdapterOptions,
): FindogAgentKnowledgeAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!/\/api\/v1$/.test(baseUrl)) {
    throw new FindogAgentAdapterError(
      "invalid_request",
      "Die WeKnora-Basis-URL muss mit /api/v1 enden.",
    );
  }

  const allowedKnowledgeBases = new Set(options.knowledgeBaseIds);
  /** Verifies a document's knowledge base when the search hit omitted it. */
  const documentMetaCache = new Map<
    string,
    { knowledgeBaseId: string | null; title: string | null; sourceUrl: string | null }
  >();

  function endpoint(path: string): string {
    return `${baseUrl}/${path}`;
  }

  function assertKnowledgeBaseAllowed(knowledgeBaseId: string | null): string {
    if (!knowledgeBaseId || !allowedKnowledgeBases.has(knowledgeBaseId)) {
      throw new FindogAgentAdapterError(
        "scope_denied",
        "Diese Wissensbasis gehört nicht zum konfigurierten Umfang.",
      );
    }
    return knowledgeBaseId;
  }

  async function send(
    path: string,
    init: {
      method: "GET" | "POST";
      body?: unknown;
      signal?: AbortSignal | null;
      purpose: string;
      /** 404 handling: plain reads report `not_found`, wiki routes `unavailable`. */
      notFound?: "not_found" | "unavailable";
    },
  ): Promise<FindogAgentTransportResponse> {
    const response = await options.transport.send({
      url: endpoint(path),
      method: init.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": options.apiKey,
      },
      body: init.body === undefined ? null : JSON.stringify(init.body),
      purpose: init.purpose,
      timeoutMs: options.timeoutMs,
      signal: init.signal ?? null,
    });

    if (response.status === 401 || response.status === 403) {
      throw new FindogAgentAdapterError(
        "upstream_error",
        "WeKnora hat den Zugangsschlüssel abgelehnt.",
        response.status,
      );
    }
    if (response.status === 404) {
      if (init.notFound === "unavailable") {
        throw new FindogAgentAdapterError("unavailable", "Dieser Wiki-Endpunkt ist nicht verfügbar.", 404);
      }
      throw new FindogAgentAdapterError("not_found", "Der Wissensdatensatz existiert nicht.", 404);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FindogAgentAdapterError(
        "upstream_error",
        `WeKnora hat mit Status ${response.status} geantwortet.`,
        response.status,
      );
    }
    return response;
  }

  /**
   * Parses the WeKnora envelope and keeps the pagination `total` alongside the
   * payload. Upstream-provided error text is never surfaced: it may echo keys or
   * sensitive diagnostics, so a fixed typed message is used instead.
   */
  async function parseEnvelopeFull(
    response: FindogAgentTransportResponse,
  ): Promise<{ data: unknown; total: number | null }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new FindogAgentAdapterError(
        "invalid_response",
        "WeKnora hat keine gültige JSON-Antwort geliefert.",
      );
    }
    const envelope = asRecord(parsed);
    if (envelope && envelope.success === false) {
      throw new FindogAgentAdapterError("upstream_error", "WeKnora hat die Anfrage abgelehnt.");
    }
    const data = envelope && "data" in envelope ? envelope.data : parsed;
    const dataRecord = asRecord(data);
    const total = (envelope ? asCount(envelope.total) : null)
      ?? (dataRecord ? asCount(dataRecord.total) : null);
    return { data, total };
  }

  async function parseEnvelope(response: FindogAgentTransportResponse): Promise<unknown> {
    return (await parseEnvelopeFull(response)).data;
  }

  function toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    const record = asRecord(value);
    if (record) {
      for (const key of ["items", "list", "results", "knowledge", "chunks"]) {
        if (Array.isArray(record[key])) {
          return record[key] as unknown[];
        }
      }
    }
    return [];
  }

  async function documentMetaOf(
    knowledgeId: string,
    signal?: AbortSignal | null,
  ): Promise<{ knowledgeBaseId: string | null; title: string | null; sourceUrl: string | null }> {
    const cached = documentMetaCache.get(knowledgeId);
    if (cached !== undefined) {
      return cached;
    }
    const response = await send(`knowledge/${encodePathSegment(knowledgeId)}`, {
      method: "GET",
      signal,
      purpose: "knowledge:verify-scope",
    });
    const detail = asRecord(await parseEnvelope(response));
    const metadata = detail ? asRecord(detail.metadata) : null;
    const meta = {
      knowledgeBaseId: detail ? asString(detail.knowledge_base_id) : null,
      title: detail
        ? asString(detail.title) ?? asString(detail.file_name) ?? asString(detail.knowledge_title)
        : null,
      sourceUrl: detail
        ? asString(detail.url) ?? (metadata ? asString(metadata.url) : null)
        : null,
    };
    documentMetaCache.set(knowledgeId, meta);
    return meta;
  }

  return {
    knowledgeBaseIds: [...options.knowledgeBaseIds],

    async listKnowledgeBases(input) {
      const response = await send("knowledge-bases", {
        method: "GET",
        signal: input?.signal ?? null,
        purpose: "knowledge:list-bases",
      });
      const entries = toArray(await parseEnvelope(response));
      const bases: FindogAgentKnowledgeBaseSummary[] = [];
      for (const entry of entries) {
        const record = asRecord(entry);
        const id = record
          ? asString(record.id) ?? asString(record.knowledge_base_id) ?? asString(record.kb_id)
          : null;
        if (!record || !id) {
          continue;
        }
        bases.push({
          id,
          name: asString(record.name)
            ?? asString(record.title)
            ?? asString(record.knowledge_base_name)
            ?? id,
          configured: allowedKnowledgeBases.has(id),
        });
      }
      return bases;
    },

    async search(input) {
      const response = await send("knowledge-search", {
        method: "POST",
        signal: input.signal,
        purpose: "knowledge:search",
        body: {
          query: input.query,
          knowledge_base_ids: [...options.knowledgeBaseIds],
        },
      });
      const results = toArray(await parseEnvelope(response));
      const hits: FindogAgentKnowledgeHit[] = [];
      const notes: string[] = [];
      let filtered = 0;

      for (const entry of results.slice(0, Math.max(1, input.limit) * 3)) {
        const record = asRecord(entry);
        const knowledgeId = record ? asString(record.knowledge_id) : null;
        if (!record || !knowledgeId) {
          filtered += 1;
          continue;
        }

        let knowledgeBaseId = asString(record.knowledge_base_id);
        if (!knowledgeBaseId) {
          // The scope is only trusted after the document metadata confirms it.
          knowledgeBaseId = (await documentMetaOf(knowledgeId, input.signal)).knowledgeBaseId;
          if (!knowledgeBaseId) {
            filtered += 1;
            notes.push("Ein Suchergebnis ohne bestätigte Wissensbasis wurde verworfen.");
            continue;
          }
        }
        if (!allowedKnowledgeBases.has(knowledgeBaseId)) {
          filtered += 1;
          continue;
        }

        const bounded = boundFindogAgentText(record.content, options.maxTextCharacters);
        hits.push({
          knowledgeId,
          chunkId: asString(record.id),
          knowledgeBaseId,
          title: asString(record.knowledge_title) ?? asString(record.knowledge_filename) ?? "Wissensdokument",
          text: bounded.text,
          truncated: bounded.truncated,
          score: asNumber(record.score),
          sourceUrl: null,
          filename: asString(record.knowledge_filename),
        });
        if (hits.length >= Math.max(1, input.limit)) {
          break;
        }
      }

      return { hits, filtered, notes };
    },

    async readKnowledge(input) {
      // Membership is verified before any chunk content is fetched or trusted.
      const meta = await documentMetaOf(input.knowledgeId, input.signal);
      const knowledgeBaseId = assertKnowledgeBaseAllowed(meta.knowledgeBaseId);

      // The continuation is chunk-granular so a truncated read never drops the
      // tail of a page: the caller resumes at exactly the first unread chunk.
      const startChunk = Math.max(0, asCount(input.startChunk) ?? 0);
      let page = Math.floor(startChunk / CHUNK_PAGE_SIZE) + 1;
      let skip = startChunk % CHUNK_PAGE_SIZE;
      let pagesRead = 0;
      let totalChunks: number | null = null;
      let chunksRead = 0;
      let accumulated = 0;
      let truncated = false;
      let nextChunk: number | null = null;
      const pageTexts: string[] = [];

      // Respect the envelope pagination instead of always reading page 1: keep
      // fetching pages until the document is complete, the text cap is reached
      // or the bounded page cap is hit. Truncation is always reported honestly
      // together with the exact continuation index.
      while (pagesRead < MAX_CHUNK_PAGES) {
        const response = await send(
          `chunks/${encodePathSegment(input.knowledgeId)}?page=${page}&page_size=${CHUNK_PAGE_SIZE}`,
          { method: "GET", signal: input.signal, purpose: "knowledge:read-chunks" },
        );
        const envelope = await parseEnvelopeFull(response);
        if (envelope.total !== null) {
          totalChunks = envelope.total;
        }
        const chunks = toArray(envelope.data);
        pagesRead += 1;

        const pageStartIndex = (page - 1) * CHUNK_PAGE_SIZE;
        let stoppedByCap = false;
        for (let index = skip; index < chunks.length; index += 1) {
          const chunk = asRecord(chunks[index]);
          if (!chunk) {
            continue;
          }
          // Scope is re-verified on every page and every chunk.
          const chunkKnowledgeId = asString(chunk.knowledge_id);
          if (chunkKnowledgeId && chunkKnowledgeId !== input.knowledgeId) {
            throw new FindogAgentAdapterError(
              "scope_denied",
              "Die Antwort enthielt Abschnitte eines anderen Dokuments.",
            );
          }
          const chunkKnowledgeBaseId = asString(chunk.knowledge_base_id);
          if (chunkKnowledgeBaseId && !allowedKnowledgeBases.has(chunkKnowledgeBaseId)) {
            throw new FindogAgentAdapterError(
              "scope_denied",
              "Die Antwort enthielt Abschnitte einer nicht freigegebenen Wissensbasis.",
            );
          }
          const content = asString(chunk.content);
          if (!content) {
            continue;
          }
          const separator = pageTexts.length > 0 ? 2 : 0;
          const projected = accumulated + separator + content.length;
          if (pageTexts.length > 0 && projected > options.maxTextCharacters) {
            // Stop before the chunk that would exceed the cap and hand back its
            // exact index; nothing before or after it is silently dropped.
            truncated = true;
            nextChunk = pageStartIndex + index;
            stoppedByCap = true;
            break;
          }
          pageTexts.push(content);
          accumulated = projected;
          chunksRead += 1;
        }
        if (stoppedByCap) {
          break;
        }

        const consumedUpTo = pageStartIndex + chunks.length;
        const morePages = totalChunks !== null
          ? consumedUpTo < totalChunks
          : chunks.length === CHUNK_PAGE_SIZE;
        if (!morePages) {
          nextChunk = null;
          break;
        }
        if (pagesRead >= MAX_CHUNK_PAGES) {
          truncated = true;
          nextChunk = consumedUpTo;
          break;
        }
        skip = 0;
        page += 1;
      }

      const bounded = boundFindogAgentText(pageTexts.join("\n\n"), options.maxTextCharacters);
      if (bounded.truncated) {
        // The text cap clipped content; report it honestly.
        truncated = true;
      }
      return {
        knowledgeId: input.knowledgeId,
        knowledgeBaseId,
        title: meta.title ?? input.knowledgeId,
        text: bounded.text,
        truncated,
        chunksRead,
        totalChunks,
        nextChunk: truncated ? nextChunk : null,
        sourceUrl: meta.sourceUrl,
      };
    },

    async wikiSearch(input) {
      const knowledgeBaseId = assertKnowledgeBaseAllowed(input.knowledgeBaseId);
      const query = `q=${encodeURIComponent(input.query)}&limit=${Math.max(1, Math.min(20, input.limit))}`;
      const response = await send(
        `knowledgebase/${encodePathSegment(knowledgeBaseId)}/wiki/search?${query}`,
        {
          method: "GET",
          signal: input.signal,
          purpose: "knowledge:wiki-search",
          notFound: "unavailable",
        },
      );
      return toArray(await parseEnvelope(response)).flatMap((entry) => {
        const page = asRecord(entry);
        const slug = page ? asString(page.slug) : null;
        if (!page || !slug) {
          return [];
        }
        return [{
          slug,
          title: asString(page.title) ?? slug,
          summary: asString(page.summary) ?? "",
          pageType: asString(page.page_type) ?? "",
        }];
      });
    },

    async wikiRead(input) {
      const knowledgeBaseId = assertKnowledgeBaseAllowed(input.knowledgeBaseId);
      const slug = encodeFindogAgentSlug(input.slug);
      const response = await send(
        `knowledgebase/${encodePathSegment(knowledgeBaseId)}/wiki/pages/${slug}`,
        {
          method: "GET",
          signal: input.signal,
          purpose: "knowledge:wiki-read",
          notFound: "unavailable",
        },
      );
      const page = asRecord(await parseEnvelope(response));
      const content = page ? asString(page.content) : null;
      if (!page || !content) {
        throw new FindogAgentAdapterError("unavailable", "Diese Wiki-Seite ist nicht verfügbar.");
      }
      const bounded = boundFindogAgentText(content, options.maxTextCharacters);
      return {
        slug: asString(page.slug) ?? input.slug,
        title: asString(page.title) ?? input.slug,
        pageType: asString(page.page_type) ?? "",
        text: bounded.text,
        truncated: bounded.truncated,
      };
    },
  };
}
