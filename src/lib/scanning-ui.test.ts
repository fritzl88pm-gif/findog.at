import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(fileURLToPath(new URL("../components/scanning-view.tsx", import.meta.url)), "utf8");
const richAnswerSource = readFileSync(fileURLToPath(new URL("../components/rich-answer.tsx", import.meta.url)), "utf8");
const routeSource = readFileSync(fileURLToPath(new URL("../app/api/scanning/route.ts", import.meta.url)), "utf8");
const providerSource = readFileSync(fileURLToPath(new URL("./scanning/openrouter.ts", import.meta.url)), "utf8");

describe("Scanning UI integration", () => {
  it("adds Scanning to both navigation modes as its own app view", () => {
    expect(pageSource).toContain('type AppView = "chat" | "scanning"');
    expect(pageSource.match(/onClick=\{openScanningView\}/gu)).toHaveLength(2);
    expect(pageSource).toContain('appView === "scanning"');
    expect(pageSource).toContain("<ScanningView accessToken={session?.access_token ?? \"\"} />");
  });

  it("supports drag-and-drop, removable chips, progress, cancellation and PDF export", () => {
    expect(viewSource).toContain("onDrop={handleDrop}");
    expect(viewSource).toContain("Bilder auswählen");
    expect(viewSource).toContain("PDFs auswählen");
    expect(viewSource).toContain("Ausgewählt: {images.length}/{MAX_SCANNING_IMAGES} Bilder");
    expect(viewSource).toContain("Entfernen");
    expect(viewSource).toContain("Abbrechen");
    expect(viewSource).toContain("Neue Auswertung");
    expect(viewSource).toContain("Zusätzliche Anweisungen");
    expect(viewSource).toContain("nur Apothekenrechnungen, nur Büromaterialien oder nur Amazon-Rechnungen");
    expect(viewSource).toContain('formData.append("instructions", normalizedInstructions)');
    expect(viewSource).toContain("scanning-pdf-button");
    expect(viewSource).toContain('fetch("/api/scanning"');
    expect(viewSource).toContain('fetch("/api/tools/pdf"');
    expect(viewSource).toContain("abortRef.current?.abort()");
  });

  it("shares Fred's rich answer renderer and does not persist scanning data", () => {
    expect(pageSource).toContain('import RichAnswer from "@/components/rich-answer"');
    expect(viewSource).toContain('import RichAnswer from "@/components/rich-answer"');
    expect(richAnswerSource).toContain("parseRichAnswer(content)");
    expect(routeSource).not.toMatch(/\bsupabase\.from\(/u);
    expect(routeSource).not.toMatch(/\bsupabase\.rpc\(/u);
    expect(providerSource).toContain("data:${upload.mimeType};base64");
    expect(providerSource).not.toContain("/files");
  });
});
