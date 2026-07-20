
import { describe, expect, it, vi } from "vitest";
import { buildAttachmentContext, type AttachmentInput } from "./context";

function pdfInput(name = "doc.pdf"): AttachmentInput {
  return {
    kind: "pdf",
    name,
    mimeType: "application/pdf",
    sizeBytes: 100,
    sha256: "hash-" + name,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  };
}

function pngInput(name = "img.png"): AttachmentInput {
  return {
    kind: "png",
    name,
    mimeType: "image/png",
    sizeBytes: 200,
    sha256: "hash-" + name,
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
}

function txtInput(name = "notes.txt", content = "Hello World"): AttachmentInput {
  return {
    kind: "txt",
    name,
    mimeType: "text/plain",
    sizeBytes: content.length,
    sha256: "hash-" + name,
    bytes: new TextEncoder().encode(content),
  };
}

function mdInput(name = "readme.md", content = "# Markdown"): AttachmentInput {
  return {
    kind: "md",
    name,
    mimeType: "text/markdown",
    sizeBytes: content.length,
    sha256: "hash-" + name,
    bytes: new TextEncoder().encode(content),
  };
}

describe("Attachment context builder", () => {
  it("routes PDF to MinerU provider and returns its markdown in context", async () => {
    const mineruProvider = vi.fn().mockResolvedValue(["# Extracted PDF text"]);
    const geminiProvider = vi.fn();

    const result = await buildAttachmentContext(
      "What does this document say?",
      [pdfInput("report.pdf")],
      { mineruProvider, geminiProvider },
    );

    expect(mineruProvider).toHaveBeenCalledTimes(1);
    expect(mineruProvider).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: "pdf", name: "report.pdf" })],
    );
    expect(geminiProvider).not.toHaveBeenCalled();
    expect(result).toContain("# Extracted PDF text");
    expect(result).toContain("unsichere");
  });

  it("routes images to Gemini provider (max 2 concurrent)", async () => {
    const mineruProvider = vi.fn();
    const geminiProvider = vi.fn()
      .mockResolvedValueOnce("Image description A")
      .mockResolvedValueOnce("Image description B");

    const result = await buildAttachmentContext(
      "What's in these images?",
      [pngInput("a.png"), pngInput("b.png")],
      { mineruProvider, geminiProvider },
    );

    expect(geminiProvider).toHaveBeenCalledTimes(2);
    expect(mineruProvider).not.toHaveBeenCalled();
    expect(result).toContain("Image description A");
    expect(result).toContain("Image description B");
  });

  it("preserves original attachment order in the built context", async () => {
    const mineruProvider = vi.fn().mockResolvedValue(["PDF result"]);
    const geminiProvider = vi.fn()
      .mockResolvedValueOnce("Second image content")
      .mockResolvedValueOnce("First image content");

    const result = await buildAttachmentContext(
      "Order test",
      [pngInput("first.png"), pngInput("second.png")],
      { mineruProvider, geminiProvider },
    );

    // Attachment markers should preserve file order regardless of completion order
    const firstMarker = result.indexOf("[Anhang: first.png]");
    const secondMarker = result.indexOf("[Anhang: second.png]");
    expect(firstMarker).toBeLessThan(secondMarker);
  });

  it("decodes TXT, MD, CSV as UTF-8 locally", async () => {
    const mineruProvider = vi.fn();
    const geminiProvider = vi.fn();

    const result = await buildAttachmentContext(
      "Read these files",
      [txtInput("hello.txt", "Hello World"), mdInput("readme.md", "# Doc")],
      { mineruProvider, geminiProvider },
    );

    expect(mineruProvider).not.toHaveBeenCalled();
    expect(geminiProvider).not.toHaveBeenCalled();
    expect(result).toContain("Hello World");
    expect(result).toContain("# Doc");
  });

  it("rejects unsupported attachment types before any provider call", async () => {
    const bad: AttachmentInput = {
      kind: "svg" as AttachmentInput["kind"],
      name: "bad.svg",
      mimeType: "image/svg+xml",
      sizeBytes: 50,
      sha256: "hash-bad",
      bytes: new Uint8Array([0x3c]),
    };

    await expect(buildAttachmentContext("Test", [bad]))
      .rejects.toThrow(/svg/);
  });

  it("builds a complete Fred query from original question and bounded context", async () => {
    const mineruProvider = vi.fn().mockResolvedValue(["Extracted PDF content"]);
    const geminiProvider = vi.fn();

    const result = await buildAttachmentContext(
      "What is the total amount?",
      [pdfInput("invoice.pdf")],
      { mineruProvider, geminiProvider },
    );

    expect(result).toContain("What is the total amount?");
    expect(result).toContain("Extracted PDF content");
    expect(result).toContain("unsichere");
    expect(result).toContain("ignoriert werden");
  });

  it("caps total attachment content at 120,000 chars with head+tail preservation", async () => {
    const mineruProvider = vi.fn().mockResolvedValue(["x".repeat(150_000)]);
    const geminiProvider = vi.fn();

    const result = await buildAttachmentContext(
      "Q",
      [pdfInput("big.pdf")],
      { mineruProvider, geminiProvider },
    );

    // Total content (question + context) should be capped
    expect(result.length).toBeLessThanOrEqual(125_000);
    expect(result).toContain("[Attachment context truncated]");
  });

  it("uses fail-closed semantics: provider failure throws", async () => {
    const mineruProvider = vi.fn().mockRejectedValue(new Error("MinerU unavailable"));
    await expect(buildAttachmentContext("Q", [pdfInput()], { mineruProvider }))
      .rejects.toThrow();
  });

  it("processes MinerU batch and Gemini images in a single call", async () => {
    const mineruProvider = vi.fn().mockResolvedValue(["PDF result"]);
    const geminiProvider = vi.fn().mockResolvedValueOnce("Image description");

    const result = await buildAttachmentContext(
      "Mixed query",
      [pdfInput("doc.pdf"), pngInput("photo.png")],
      { mineruProvider, geminiProvider },
    );

    expect(mineruProvider).toHaveBeenCalled();
    expect(geminiProvider).toHaveBeenCalled();
    expect(result).toContain("PDF result");
    expect(result).toContain("Image description");
  });

  it("starts bounded Gemini work before a pending MinerU batch resolves", async () => {
    let resolveMineru!: (value: string[]) => void;
    const mineruPending = new Promise<string[]>((resolve) => { resolveMineru = resolve; });
    const mineruProvider = vi.fn(() => mineruPending);
    const geminiProvider = vi.fn().mockResolvedValue("image result");

    const pending = buildAttachmentContext(
      "Concurrent",
      [pdfInput("pending.pdf"), pngInput("started.png")],
      { mineruProvider, geminiProvider },
    );

    await vi.waitFor(() => expect(geminiProvider).toHaveBeenCalledTimes(1));
    resolveMineru(["pdf result"]);
    await expect(pending).resolves.toContain("image result");
  });

  it("preserves duplicate filenames by input identity", async () => {
    const mineruProvider = vi.fn().mockResolvedValue(["first duplicate", "second duplicate"]);
    const result = await buildAttachmentContext(
      "Duplicates",
      [pdfInput("same.pdf"), pdfInput("same.pdf")],
      { mineruProvider },
    );

    expect(result).toContain("first duplicate");
    expect(result).toContain("second duplicate");
    expect(result.indexOf("first duplicate")).toBeLessThan(result.indexOf("second duplicate"));
    expect(result.match(/\[Anhang: same\.pdf\]/g)).toHaveLength(2);
  });

  it("keeps a 50,000-character question byte-for-byte as the query prefix", async () => {
    const question = "Frage-🙂-".repeat(5_000).slice(0, 50_000);
    const result = await buildAttachmentContext(question, [txtInput("short.txt", "text")]);
    expect(result.startsWith(`${question}\n\n`)).toBe(true);
    expect(result.slice(0, question.length)).toBe(question);
  });

  it("budgets attachment material only and preserves head and tail with a readable marker", async () => {
    const content = `HEAD-${"x".repeat(130_000)}-TAIL`;
    const mineruProvider = vi.fn().mockResolvedValue([content]);
    const question = "q".repeat(50_000);
    const result = await buildAttachmentContext(question, [pdfInput("big.pdf")], { mineruProvider });
    const attachmentContext = result.slice(question.length + 2);

    expect(attachmentContext.length).toBeLessThanOrEqual(120_000);
    expect(attachmentContext).toContain("HEAD-");
    expect(attachmentContext).toContain("-TAIL");
    expect(attachmentContext).toContain("[Attachment context truncated]");
  });

  it.each([
    ["MinerU count mismatch", [pdfInput("a.pdf"), pdfInput("b.pdf")], { mineruProvider: vi.fn().mockResolvedValue(["one"]) }],
    ["MinerU empty output", [pdfInput("a.pdf")], { mineruProvider: vi.fn().mockResolvedValue(["   "]) }],
    ["Gemini empty output", [pngInput("a.png")], { geminiProvider: vi.fn().mockResolvedValue("") }],
  ])("fails closed for %s", async (_label, inputs, providers) => {
    await expect(buildAttachmentContext("Q", inputs, providers)).rejects.toThrow();
  });

  it("maps invalid local UTF-8 to a controlled user-visible filename error", async () => {
    const invalid = txtInput("bad<script>.txt", "valid");
    const attachment = { ...invalid, bytes: new Uint8Array([0xc3, 0x28]) };
    const error = (await buildAttachmentContext("Q", [attachment]).catch((caught) => caught as Error)) as Error;

    expect(error.name).toBe("AttachmentsError");
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("badscript.txt");
  });
});
