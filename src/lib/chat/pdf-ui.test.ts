import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8",
);

describe("chat PDF offer UI", () => {
  it("renders downloads from the structured agent offer instead of browser-side intent guessing", () => {
    expect(pageSource).toContain('message.role === "assistant" && message.pdfOffer');
    expect(pageSource).toContain("const pdfOffer = normalizePdfOffer(payload.pdfOffer)");
    expect(pageSource).toContain("title: message.pdfOffer?.title.trim().slice(0, 160)");
    expect(pageSource).not.toContain("shouldOfferChatPdfDownload");
  });
});
