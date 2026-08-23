import { describe, expect, it, vi } from "vitest";

import {
  BfgCitationCache,
  extractBfgGzCandidates,
  extractStreamStableBfgGzCandidates,
  findUnverifiedBfgCitations,
  linkVerifiedBfgCitations,
  resolveBfgCitation,
  verifyBfgCitations,
} from "./bfg-citations";
import { createDeadline } from "../deadline";

const validFindokBody = {
  dokumentId: "121623",
  segmentId: "539712b1-4660-4846-8ccd-d2dbba5a234f",
  indexName: "findok-bfg",
  dokumentPdfMediaUrl: "findok/resources/pdf/539712b1-4660-4846-8ccd-d2dbba5a234f/121623.pdf",
  dokumentTitel: "BFG 01.01.2024, RV/7103053/2014",
  titel: "Anrechnung von Quellensteuern nach DBA-Schweiz",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("Findok BFG citation verification", () => {
  it("extracts supported BFG GZ candidates once and strips punctuation", () => {
    expect(
      extractBfgGzCandidates(
        "Siehe RV/7103053/2014, RS/7100001/2020. Nochmals RV/7103053/2014); AW/7100130/2019 und vh/7100002/2022.",
      ),
    ).toEqual([
      "RV/7103053/2014",
      "RS/7100001/2020",
      "AW/7100130/2019",
      "VH/7100002/2022",
    ]);
  });

  it("waits for a stream boundary before treating a trailing GZ as complete", () => {
    expect(extractStreamStableBfgGzCandidates("Siehe RV/1100290/2023")).toEqual([]);
    expect(extractStreamStableBfgGzCandidates("Siehe RV/1100290/2023 ")).toEqual([
      "RV/1100290/2023",
    ]);
    expect(extractStreamStableBfgGzCandidates("**RV/1100290/2023**")).toEqual([
      "RV/1100290/2023",
    ]);
    expect(extractStreamStableBfgGzCandidates("Siehe RV/1100290/2023", true)).toEqual([
      "RV/1100290/2023",
    ]);
  });

  it("resolves a valid Findok BFG response to official full-text and PDF URLs", async () => {
    const deadline = createDeadline(240_000);
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(validFindokBody));

    await expect(resolveBfgCitation("RV/7103053/2014", fetchImpl, { deadline })).resolves.toMatchObject({
      status: "verified",
      gz: "RV/7103053/2014",
      title: "Anrechnung von Quellensteuern nach DBA-Schweiz",
      documentTitle: "BFG 01.01.2024, RV/7103053/2014",
      indexName: "findok-bfg",
      pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/539712b1-4660-4846-8ccd-d2dbba5a234f/121623.pdf",
      fullTextUrl: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "https://findok.bmf.gv.at/findok/api/volltext/gz?gz=RV%2F7103053%2F2014",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    deadline.dispose();
  });

  it("rejects missing, non-BFG, and missing-PDF resolver responses", async () => {
    await expect(resolveBfgCitation("RV/7103080/2015", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })))).resolves.toMatchObject({
      status: "not_found",
      gz: "RV/7103080/2015",
    });

    await expect(
      resolveBfgCitation(
        "RV/7103053/2014",
        vi.fn().mockResolvedValue(jsonResponse({ ...validFindokBody, indexName: "findok-ufs" })),
      ),
    ).resolves.toMatchObject({
      status: "not_bfg",
      gz: "RV/7103053/2014",
    });

    await expect(
      resolveBfgCitation(
        "RV/7103053/2014",
        vi.fn().mockResolvedValue(jsonResponse({ ...validFindokBody, dokumentPdfMediaUrl: "" })),
      ),
    ).resolves.toMatchObject({
      status: "missing_pdf",
      gz: "RV/7103053/2014",
    });
  });

  it("linkifies only verified citations and reports unverified final-answer citations", () => {
    const verified = {
      status: "verified" as const,
      gz: "RV/7103053/2014",
      title: "Anrechnung von Quellensteuern",
      documentTitle: "BFG 01.01.2024, RV/7103053/2014",
      dokumentId: "121623",
      segmentId: "segment",
      indexName: "findok-bfg" as const,
      fullTextUrl: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014",
      pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/segment/121623.pdf",
    };

    expect(
      linkVerifiedBfgCitations(
        "Siehe RV/7103053/2014 und [RV/7103053/2014](https://example.test/falsch.pdf).",
        [verified],
      ),
    ).toBe(
      "Siehe [RV/7103053/2014](https://findok.bmf.gv.at/findok/resources/pdf/segment/121623.pdf) und [RV/7103053/2014](https://findok.bmf.gv.at/findok/resources/pdf/segment/121623.pdf).",
    );
    expect(linkVerifiedBfgCitations(
      "Siehe RV/7103053/2014.",
      [verified],
      { target: "fullText" },
    )).toBe(
      "Siehe [RV/7103053/2014](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014).",
    );
    expect(linkVerifiedBfgCitations(
      "Siehe **RV/7103053/2014**.",
      [verified],
      { target: "fullText" },
    )).toBe(
      "Siehe **[RV/7103053/2014](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014)**.",
    );

    expect(
      findUnverifiedBfgCitations(
        "Siehe RV/7103053/2014, RV/7103080/2015 und RS/7100001/2020.",
        [verified],
      ),
    ).toEqual(["RV/7103080/2015", "RS/7100001/2020"]);
  });

  it("caches verified resolutions until their TTL expires", async () => {
    let now = 1_000;
    const cache = new BfgCitationCache({ now: () => now, verifiedTtlMs: 100, negativeTtlMs: 20 });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validFindokBody));

    await verifyBfgCitations(["rv/7103053/2014"], fetchImpl, { cache });
    await verifyBfgCitations([" RV/7103053/2014 "], fetchImpl, { cache });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 101;
    await verifyBfgCitations(["RV/7103053/2014"], fetchImpl, { cache });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches stable negative resolutions only for the shorter TTL", async () => {
    let now = 2_000;
    const cache = new BfgCitationCache({ now: () => now, verifiedTtlMs: 1_000, negativeTtlMs: 50 });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    await verifyBfgCitations(["RV/7103080/2015"], fetchImpl, { cache });
    now += 49;
    await verifyBfgCitations(["RV/7103080/2015"], fetchImpl, { cache });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 2;
    await verifyBfgCitations(["RV/7103080/2015"], fetchImpl, { cache });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retain transient errors", async () => {
    const cache = new BfgCitationCache();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(validFindokBody));

    await expect(verifyBfgCitations(["RV/7103053/2014"], fetchImpl, { cache }))
      .resolves.toMatchObject({ rejected: [expect.objectContaining({ status: "error" })] });
    await expect(verifyBfgCitations(["RV/7103053/2014"], fetchImpl, { cache }))
      .resolves.toMatchObject({ verified: [expect.objectContaining({ status: "verified" })] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent normalized GZ resolutions", async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const cache = new BfgCitationCache();

    const first = verifyBfgCitations(["rv/7103053/2014"], fetchImpl, { cache });
    const second = verifyBfgCitations([" RV/7103053/2014 "], fetchImpl, { cache });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    release(jsonResponse(validFindokBody));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("evicts deterministically when the cache reaches its maximum size", async () => {
    const cache = new BfgCitationCache({ maxEntries: 2 });
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(validFindokBody));

    await verifyBfgCitations(["RV/1/2024"], fetchImpl, { cache });
    await verifyBfgCitations(["RV/2/2024"], fetchImpl, { cache });
    await verifyBfgCitations(["RV/3/2024"], fetchImpl, { cache });
    await verifyBfgCitations(["RV/1/2024"], fetchImpl, { cache });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(cache.size).toBe(2);
  });

  it("does not let an aborted caller poison a coalesced shared resolution", async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const cache = new BfgCitationCache();
    const controller = new AbortController();

    const aborted = verifyBfgCitations(["RV/7103053/2014"], fetchImpl, {
      cache,
      signal: controller.signal,
    });
    const survivor = verifyBfgCitations(["RV/7103053/2014"], fetchImpl, { cache });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    release(jsonResponse(validFindokBody));

    await expect(aborted).resolves.toMatchObject({
      rejected: [expect.objectContaining({ status: "error" })],
    });
    await expect(survivor).resolves.toMatchObject({
      verified: [expect.objectContaining({ status: "verified" })],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not schedule Findok misses for an already-aborted caller", async () => {
    const cache = new BfgCitationCache();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validFindokBody));
    const controller = new AbortController();
    controller.abort(new Error("caller stopped"));

    await verifyBfgCitations(
      Array.from({ length: 12 }, (_, index) => `RV/${index + 1}/2098`),
      fetchImpl,
      { cache, signal: controller.signal },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it("reports one structured batch summary with cache and error counts", async () => {
    let metricsNow = 100;
    const onMetrics = vi.fn();
    const cache = new BfgCitationCache();
    await verifyBfgCitations(["RV/1/2024"], vi.fn().mockResolvedValue(jsonResponse(validFindokBody)), { cache });
    let release!: (resolution: Awaited<ReturnType<typeof resolveBfgCitation>>) => void;
    void cache.resolve(
      "RV/2/2024",
      () => new Promise((resolve) => { release = resolve; }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    const verification = verifyBfgCitations(
      ["RV/1/2024", "rv/2/2024", "RV/3/2024", "RV/3/2024"],
      vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
      { cache, metricsNow: () => metricsNow, onMetrics },
    );
    metricsNow = 142;
    release({
      status: "error",
      gz: "RV/2/2024",
      reason: "Findok hat nicht rechtzeitig geantwortet.",
    });
    await verification;

    expect(onMetrics).toHaveBeenCalledOnce();
    expect(onMetrics).toHaveBeenCalledWith({
      candidateCount: 3,
      verifiedCount: 1,
      cacheHits: 1,
      cacheMisses: 1,
      coalesced: 1,
      durationMs: 42,
      timeoutCount: 1,
      errorCount: 1,
    });
  });
});
