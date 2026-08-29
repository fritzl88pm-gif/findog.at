import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseRichAnswer, richInlinePlainText } from "@/lib/answer-rendering";

const componentSource = readFileSync(
  fileURLToPath(new URL("./fred-native-image.tsx", import.meta.url)),
  "utf8",
);
const richAnswerSource = readFileSync(
  fileURLToPath(new URL("./rich-answer.tsx", import.meta.url)),
  "utf8",
);
const nextConfigSource = readFileSync(
  fileURLToPath(new URL("../../next.config.ts", import.meta.url)),
  "utf8",
);

describe("FredNativeImage component and rendering integration", () => {
  it("is a client component and only accepts artifactId and alt props", () => {
    expect(componentSource).toContain('"use client"');
    expect(componentSource).toContain("artifactId");
    expect(componentSource).toContain("alt");
    expect(componentSource).not.toContain("sourceUri");
    expect(componentSource).not.toContain("providerUri");
    expect(componentSource).not.toContain("file_path");
    expect(componentSource).not.toContain("apiKey");
  });

  it("fetches authenticated same-origin artifact endpoint with Bearer token and AbortController", () => {
    expect(componentSource).toContain("getSupabaseBrowserClient");
    expect(componentSource).toContain("auth.getSession");
    expect(componentSource).toContain("/api/fred/artifacts/");
    expect(componentSource).toContain("Authorization: `Bearer ${token}`");
    expect(componentSource).toContain('cache: "no-store"');
    expect(componentSource).toContain("AbortController");
    expect(componentSource).toContain("signal: controller.signal");
  });

  it("creates and revokes object URLs cleanly on cleanup", () => {
    expect(componentSource).toContain("URL.createObjectURL(blob)");
    expect(componentSource).toContain("URL.revokeObjectURL(createdUrl)");
  });

  it("shows a controlled loading placeholder and discards failed artifact loads", () => {
    expect(componentSource).toContain("fred-native-image-loading");
    expect(componentSource).toContain("fred-native-image-placeholder");
    expect(componentSource).toContain('if (status === "error" || !objectUrl)');
    expect(componentSource).toContain("return null;");
    expect(componentSource).not.toContain("fred-native-image-error");
    expect(componentSource).not.toContain("Bild nicht verfügbar");
    expect(componentSource).not.toContain("console.log");
    expect(componentSource).not.toContain("console.error");
    expect(componentSource).not.toContain("console.warn");
  });

  it("RichAnswer wires FredNativeImage for image nodes and preserves alt text in plain text", () => {
    expect(richAnswerSource).toContain("FredNativeImage");
    expect(richAnswerSource).toContain('node.type === "image"');

    const artifactId = "11111111-2222-4333-8444-555555555555";
    const blocks = parseRichAnswer(`Dokument: ![Lohnzettel](findog-artifact://${artifactId})`);
    expect(blocks[0].type).toBe("paragraph");
    if (blocks[0].type === "paragraph") {
      expect(richInlinePlainText(blocks[0].children)).toBe("Dokument: Lohnzettel");
    }
  });

  it("adds blob: to img-src CSP in next.config.ts without arbitrary https wildcards", () => {
    expect(nextConfigSource).toContain("blob:");
    expect(nextConfigSource).toMatch(/img-src[^;]*blob:/);
    expect(nextConfigSource).not.toMatch(/img-src[^;]*https:\*/);
    expect(nextConfigSource).not.toMatch(/img-src[^;]*https:\s/);
    expect(nextConfigSource).not.toMatch(/img-src[^;]*\*\s/);
  });
});
