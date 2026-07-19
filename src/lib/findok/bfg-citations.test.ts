import { describe, expect, it, vi } from "vitest";

import {
  extractBfgGzCandidates,
  extractStreamStableBfgGzCandidates,
  findUnverifiedBfgCitations,
  linkVerifiedBfgCitations,
  resolveBfgCitation,
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
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validFindokBody));

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
});
