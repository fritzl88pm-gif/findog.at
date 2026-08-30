import { describe, expect, it, vi } from "vitest";

import { UserVisibleError } from "@/lib/errors";

import { parseBoundedMultipart } from "./bounded-multipart";

async function multipartFixture(fileContents = "%PDF-1.7"): Promise<{
  contentType: string;
  bytes: Uint8Array;
}> {
  const formData = new FormData();
  formData.append("payload", "hello");
  formData.append("attachment", new File([fileContents], "beleg.pdf", { type: "application/pdf" }));
  const request = new Request("https://findog.at/upload", { method: "POST", body: formData });
  return {
    contentType: request.headers.get("content-type") ?? "",
    bytes: new Uint8Array(await request.arrayBuffer()),
  };
}

function streamedRequest(bytes: Uint8Array, chunkSize: number, cancel = vi.fn()): Request {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel,
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body,
    duplex: "half",
  };
  return new Request("https://findog.at/upload", init);
}

function options(request: Request, contentType: string, overrides: {
  maxBytes?: number;
  maxFileBytes?: number;
  maxFileAggregateBytes?: number;
} = {}) {
  return {
    request,
    contentType,
    maxBytes: overrides.maxBytes ?? 1_024,
    maxFileAggregateBytes: overrides.maxFileAggregateBytes ?? 100,
    fileRules: {
      attachment: {
        maxCount: 1,
        maxBytes: overrides.maxFileBytes ?? 100,
        tooManyMessage: "too many files",
        tooLargeMessage: "file too large",
      },
    },
    fieldRules: {
      payload: { maxCount: 1, maxBytes: 100, invalidMessage: "invalid payload" },
    },
    emptyMessage: "empty",
    invalidMessage: "invalid",
    tooLargeMessage: "request too large",
    fileAggregateTooLargeMessage: "aggregate too large",
  } as const;
}

describe("parseBoundedMultipart", () => {
  it("parses multipart parts incrementally and returns direct file bytes", async () => {
    const { contentType, bytes } = await multipartFixture();
    const parsed = await parseBoundedMultipart(
      options(streamedRequest(bytes, 7), contentType),
    );

    expect(parsed.fields).toEqual([{ name: "payload", value: "hello" }]);
    expect(parsed.files).toEqual([expect.objectContaining({
      fieldName: "attachment",
      name: "beleg.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      bytes: expect.any(Uint8Array),
    })]);
    expect(new TextDecoder().decode(parsed.files[0]?.bytes)).toBe("%PDF-1.7");
  });

  it("stops an under-reported stream at the whole-request byte limit", async () => {
    const { contentType, bytes } = await multipartFixture();
    const cancel = vi.fn();

    await expect(parseBoundedMultipart(options(
      streamedRequest(bytes, 8, cancel),
      contentType,
      { maxBytes: 16 },
    ))).rejects.toMatchObject({ message: "request too large", status: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("aborts parsing on an external deadline without awaiting source cancellation", async () => {
    const { contentType, bytes } = await multipartFixture();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const deadline = new AbortController();
    deadline.abort(new UserVisibleError("upload deadline", 504));

    await expect(parseBoundedMultipart({
      ...options(streamedRequest(bytes, 8, cancel), contentType),
      signal: deadline.signal,
    })).rejects.toMatchObject({ message: "upload deadline", status: 504 });
    expect(cancel).toHaveBeenCalled();
  });

  it("unwinds a pending read even when the source cancel promise never settles", async () => {
    const { contentType } = await multipartFixture();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel,
    });
    const request = new Request("https://findog.at/upload", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const deadline = new AbortController();
    const parsing = parseBoundedMultipart({
      ...options(request, contentType),
      signal: deadline.signal,
    });

    await pullStarted;
    deadline.abort(new UserVisibleError("upload deadline", 504));

    await expect(parsing).rejects.toMatchObject({ message: "upload deadline", status: 504 });
    expect(cancel).toHaveBeenCalled();
  });

  it("enforces per-file and aggregate file bytes while consuming the part", async () => {
    const { contentType, bytes } = await multipartFixture("%PDF-1.7-longer");

    await expect(parseBoundedMultipart(options(
      streamedRequest(bytes, 5),
      contentType,
      { maxFileBytes: 8 },
    ))).rejects.toMatchObject({ message: "file too large", status: 413 });

    await expect(parseBoundedMultipart(options(
      streamedRequest(bytes, 5),
      contentType,
      { maxFileBytes: 100, maxFileAggregateBytes: 8 },
    ))).rejects.toMatchObject({ message: "aggregate too large", status: 413 });
  });

  it("rejects unknown parts and malformed multipart input", async () => {
    const unknownData = new FormData();
    unknownData.append("unknown", "value");
    const encoded = new Request("https://findog.at/upload", { method: "POST", body: unknownData });
    const unknownBytes = new Uint8Array(await encoded.arrayBuffer());

    await expect(parseBoundedMultipart(options(
      streamedRequest(unknownBytes, 20),
      encoded.headers.get("content-type") ?? "",
    ))).rejects.toMatchObject({ message: "invalid", status: 400 });

    const unknownFileData = new FormData();
    unknownFileData.append("unknown", new File(["bytes"], "unknown.bin"));
    const encodedFile = new Request("https://findog.at/upload", { method: "POST", body: unknownFileData });
    const unknownFileBytes = new Uint8Array(await encodedFile.arrayBuffer());
    await expect(parseBoundedMultipart(options(
      streamedRequest(unknownFileBytes, 20),
      encodedFile.headers.get("content-type") ?? "",
    ))).rejects.toMatchObject({ message: "invalid", status: 400 });

    await expect(parseBoundedMultipart(options(
      streamedRequest(new TextEncoder().encode("not multipart"), 4),
      "multipart/form-data; boundary=missing",
    ))).rejects.toMatchObject({ message: "invalid", status: 400 });
  });
});
