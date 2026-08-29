import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getWeKnoraDashboard } from "@/lib/weknora/dashboard";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/dashboard", () => ({ getWeKnoraDashboard: vi.fn() }));

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | null; count: number | null; error: { code: string } | null };

class FakeQuery implements PromiseLike<QueryResult> {
  readonly filters: Array<["eq" | "is" | "lte", string, unknown]> = [];
  readonly orders: Array<[string, boolean]> = [];
  private head = false;
  private maxRows: number | null = null;

  constructor(
    readonly table: string,
    private readonly rows: Row[],
    private readonly failingTables: Set<string>,
  ) {}

  select(_columns: string, options?: { count?: "exact"; head?: boolean }) {
    this.head = options?.head === true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push(["is", column, value]);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push(["lte", column, value]);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orders.push([column, options.ascending]);
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private resolve(): QueryResult {
    if (this.failingTables.has(this.table)) {
      return { data: null, count: null, error: { code: "XX000" } };
    }
    let filtered = this.rows.filter((row) => this.filters.every(([operator, column, value]) => {
      if (operator === "eq" || operator === "is") return row[column] === value;
      return String(row[column]) <= String(value);
    }));
    filtered = [...filtered].sort((left, right) => {
      for (const [column, ascending] of this.orders) {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        if (comparison !== 0) return ascending ? comparison : -comparison;
      }
      return 0;
    });
    const count = filtered.length;
    if (this.maxRows !== null) filtered = filtered.slice(0, this.maxRows);
    return { data: this.head ? null : filtered, count: this.head ? count : null, error: null };
  }
}

function newsRow(overrides: Row): Row {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "product",
    title: "Meldung",
    summary: "Kurztext",
    status: "published",
    pinned: false,
    published_at: "2026-08-01T10:00:00.000Z",
    source_system: null,
    document_kind: null,
    source_identifier: null,
    source_url: null,
    document_date: null,
    as_of_date: null,
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function fakeSupabase(options: { failingTables?: string[] } = {}) {
  const rowsByTable: Record<string, Row[]> = {
    user_reasonings: [
      { id: "r1", client_id: "user-1" },
      { id: "r2", client_id: "user-1" },
      { id: "r3", client_id: "other" },
    ],
    download_documents: [
      { id: "d1", deleted_at: null },
      { id: "d2", deleted_at: null },
      { id: "d3", deleted_at: "2026-08-01T00:00:00Z" },
    ],
    dashboard_news_items: [
      newsRow({ id: "10000000-0000-4000-8000-000000000001", title: "Alt", published_at: "2026-08-01T10:00:00.000Z" }),
      newsRow({ id: "10000000-0000-4000-8000-000000000002", title: "Angeheftet", pinned: true, published_at: "2026-07-01T10:00:00.000Z" }),
      newsRow({ id: "10000000-0000-4000-8000-000000000003", title: "Entwurf", status: "draft", published_at: null }),
      ...[1, 2, 3, 4].map((index) => newsRow({
        id: `20000000-0000-4000-8000-00000000000${index}`,
        kind: "legal",
        title: `Recht ${index}`,
        pinned: index === 1,
        published_at: `2026-08-0${index}T10:00:00.000Z`,
        source_system: "ris",
        document_kind: "norm",
        source_identifier: `BGBl-${index}`,
        source_url: `https://www.ris.bka.gv.at/Dokument-${index}`,
        document_date: `2026-07-0${index}`,
        as_of_date: "2026-08-29",
      })),
    ],
  };
  const queries: FakeQuery[] = [];
  const failing = new Set(options.failingTables ?? []);
  const client = {
    from: vi.fn((table: string) => {
      const query = new FakeQuery(table, rowsByTable[table] ?? [], failing);
      queries.push(query);
      return query;
    }),
  };
  return { client, queries };
}

const knowledgeFixture = {
  knowledgeBases: [],
  totals: { knowledgeBases: 8, contents: 100, documents: 80, faqEntries: 20, processing: 0 },
  fetchedAt: "2026-08-29T10:00:00.000Z",
  stale: false,
};

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1", email: "user@findog.at" });
    vi.mocked(getWeKnoraDashboard).mockResolvedValue(knowledgeFixture);
  });

  it("requires authentication before querying dashboard data", async () => {
    const supabase = fakeSupabase();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));

    const response = await GET(new Request("https://findog.at/api/dashboard"));

    expect(response.status).toBe(401);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("returns counts, only published news, pinned-first sorting and at most three items per kind", async () => {
    const supabase = fakeSupabase();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await GET(new Request("https://findog.at/api/dashboard", {
      headers: { Authorization: "Bearer token" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.counts).toEqual({ reasonings: 2, downloads: 2 });
    expect(payload.knowledge).toEqual({ status: "current", fetchedAt: knowledgeFixture.fetchedAt });
    expect(payload.news.product.map((item: { title: string }) => item.title)).toEqual(["Angeheftet", "Alt"]);
    expect(payload.news.legal).toHaveLength(3);
    expect(payload.news.legal[0].title).toBe("Recht 1");
    expect(payload.news.legal.every((item: { status: string }) => item.status === "published")).toBe(true);
    const newsQueries = supabase.queries.filter((query) => query.table === "dashboard_news_items");
    expect(newsQueries).toHaveLength(2);
    for (const query of newsQueries) {
      expect(query.filters).toContainEqual(["eq", "status", "published"]);
      expect(query.orders).toEqual([
        ["pinned", false],
        ["published_at", false],
        ["id", false],
      ]);
    }
  });

  it("keeps counts and news available when knowledge status fails", async () => {
    const supabase = fakeSupabase();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);
    vi.mocked(getWeKnoraDashboard).mockRejectedValue(new Error("offline"));

    const response = await GET(new Request("https://findog.at/api/dashboard"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.counts.reasonings).toBe(2);
    expect(payload.news.product).toHaveLength(2);
    expect(payload.knowledge).toEqual({ status: "unavailable", fetchedAt: null });
    expect(payload.sectionErrors.knowledge).toContain("nicht verfügbar");
  });

  it("reports one failed news section without disabling the other dashboard sections", async () => {
    const supabase = fakeSupabase({ failingTables: ["dashboard_news_items"] });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await GET(new Request("https://findog.at/api/dashboard"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.counts).toEqual({ reasonings: 2, downloads: 2 });
    expect(payload.news).toEqual({ product: [], legal: [] });
    expect(payload.sectionErrors.productNews).toBeTruthy();
    expect(payload.sectionErrors.legalNews).toBeTruthy();
  });
});
