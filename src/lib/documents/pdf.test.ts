import { expect, it } from "vitest";

import { renderChatPdf } from "./pdf";

it("renders a PDF with the real renderer", async () => {
  const bytes = await renderChatPdf({
    title: "Test document",
    content: "Small test content.",
    date: "11.07.2026",
  });

  expect(bytes.byteLength).toBeGreaterThan(0);
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toMatch(/^%PDF/);
});
