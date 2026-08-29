import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  materializeNativeImageArtifacts,
  sanitizeProviderImageMarkupToAlt,
} from "./native-image-artifacts";

describe("Native image artifacts materialization", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const conversationId = "22222222-2222-4222-8222-222222222222";
  const userMessageId = 42;

  it("rewrites exact matched trusted provider URIs to findog-artifact markers and inserts DB rows", async () => {
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const trustedImages = [
      { url: "minio://bucket/image1.jpg", caption: "Photo 1" },
    ];
    const userAttachments = [
      { kind: "image", name: "Photo 1", mimeType: "image/jpeg", sizeBytes: 1000, sha256: "a".repeat(64), bytes: new Uint8Array() },
    ];

    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: artifactId, source_uri: "minio://bucket/image1.jpg" }],
        error: null,
      }),
    });

    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: insertMock,
      }),
    } as never;

    const rawContent = "Hier ist das Dokument:\n\n![Beleg 1](minio://bucket/image1.jpg)\n\nErledigt.";
    const result = await materializeNativeImageArtifacts({
      supabase,
      userId,
      conversationId,
      userMessageId,
      rawContent,
      trustedImages,
      userAttachments,
    });

    expect(result.displayContent).toBe(
      `Hier ist das Dokument:\n\n![Beleg 1](findog-artifact://${artifactId})\n\nErledigt.`,
    );
    expect(result.artifactMap.get("minio://bucket/image1.jpg")).toBe(artifactId);

    expect(insertMock).toHaveBeenCalledWith([
      {
        conversation_id: conversationId,
        client_id: userId,
        user_message_id: userMessageId,
        source_uri: "minio://bucket/image1.jpg",
        mime_type: "image/jpeg",
        original_name: "Photo 1",
      },
    ]);
  });

  it("strips invented/unmatched provider URIs to safe alt text without inserting them", async () => {
    const trustedImages = [
      { url: "minio://bucket/real.jpg" },
    ];
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: "artifact-real", source_uri: "minio://bucket/real.jpg" }],
        error: null,
      }),
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: insertMock,
      }),
    } as never;

    const rawContent = "Echtes Bild: ![Real](minio://bucket/real.jpg)\nErfundenes Bild: ![Fake](minio://bucket/fake.jpg)";
    const result = await materializeNativeImageArtifacts({
      supabase,
      userId,
      conversationId,
      userMessageId,
      rawContent,
      trustedImages,
      userAttachments: [],
    });

    expect(result.displayContent).toBe(
      "Echtes Bild: ![Real](findog-artifact://artifact-real)\nErfundenes Bild: Fake",
    );
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ source_uri: "minio://bucket/real.jpg" }),
    ]);
    expect(insertMock).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ source_uri: "minio://bucket/fake.jpg" })]),
    );
  });

  it("discards every non-provider image marker before persistence", async () => {
    const from = vi.fn();
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const rawContent = [
      "Vorher",
      "![](/images/invented.png)",
      "![Relativ](images/invented.png)",
      "![Web](https://example.com/invented.png)",
      '![Web mit Titel](https://example.com/invented.png "Vorschau")',
      `![Erfunden](findog-artifact://${artifactId})`,
      "Nachher",
    ].join("\n");

    const result = await materializeNativeImageArtifacts({
      supabase: { from } as never,
      userId,
      conversationId,
      userMessageId,
      rawContent,
      trustedImages: [],
      userAttachments: [],
    });

    expect(result.displayContent).toBe([
      "Vorher",
      "",
      "Relativ",
      "Web",
      "Web mit Titel",
      "Erfunden",
      "Nachher",
    ].join("\n"));
    expect(result.artifactMap.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it("deduplicates multiple references to the same provider URI into a single artifact row", async () => {
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const trustedImages = [
      { url: "s3://bucket/image.png" },
    ];
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: artifactId, source_uri: "s3://bucket/image.png" }],
        error: null,
      }),
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: insertMock,
      }),
    } as never;

    const rawContent = "Erstes ![A](s3://bucket/image.png) Zweites ![B](s3://bucket/image.png)";
    const result = await materializeNativeImageArtifacts({
      supabase,
      userId,
      conversationId,
      userMessageId,
      rawContent,
      trustedImages,
      userAttachments: [{ kind: "image", name: "test.png", mimeType: "image/png" }],
    });

    expect(result.displayContent).toBe(
      `Erstes ![A](findog-artifact://${artifactId}) Zweites ![B](findog-artifact://${artifactId})`,
    );
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toHaveLength(1);
  });

  it("fails closed on database insert error by stripping provider images to alt text without throwing", async () => {
    const trustedImages = [
      { url: "minio://bucket/image.jpg" },
    ];
    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: new Error("DB connection error"),
          }),
        }),
      }),
    } as never;

    const rawContent = "Hier ist der Beleg: ![Mein Beleg](minio://bucket/image.jpg)";
    const result = await materializeNativeImageArtifacts({
      supabase,
      userId,
      conversationId,
      userMessageId,
      rawContent,
      trustedImages,
      userAttachments: [],
    });

    expect(result.displayContent).toBe("Hier ist der Beleg: Mein Beleg");
    expect(result.artifactMap.size).toBe(0);
  });

  it("bounds and cleanses alt text", async () => {
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const longAlt = "A".repeat(300) + "\x00\x1f";
    const trustedImages = [{ url: "minio://bucket/image.jpg" }];
    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: artifactId, source_uri: "minio://bucket/image.jpg" }],
            error: null,
          }),
        }),
      }),
    } as never;

    const rawContent = `![${longAlt}](minio://bucket/image.jpg)`;
    const result = await materializeNativeImageArtifacts({
      supabase,
      userId,
      conversationId,
      userMessageId,
      rawContent,
      trustedImages,
      userAttachments: [],
    });

    expect(result.displayContent).toBe(`![${"A".repeat(255)}](findog-artifact://${artifactId})`);
  });

  it("removes Markdown delimiters from alt text before serializing an artifact marker", async () => {
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const from = vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: artifactId, source_uri: "minio://bucket/image.jpg" }],
          error: null,
        }),
      }),
    });

    const result = await materializeNativeImageArtifacts({
      supabase: { from } as never,
      userId,
      conversationId,
      userMessageId,
      rawContent: "![Beleg(`gefährlich`\\[](minio://bucket/image.jpg)",
      trustedImages: [{ url: "minio://bucket/image.jpg" }],
      userAttachments: [],
    });

    expect(result.displayContent).toBe(
      `![Beleggefährlich](findog-artifact://${artifactId})`,
    );
    expect(from).toHaveBeenCalledWith("fred_native_image_artifacts");
  });

  describe("sanitizeProviderImageMarkupToAlt", () => {
    it("converts all unverified images to safe alt text and leaves normal links untouched", () => {
      const input = "Check ![Tabelle](minio://bucket/tab.png), ![Web](https://example.com/pic.png), ![Relativ](/images/pic.png) and [Link](https://findok.bmf.gv.at/findok/volltext?gz=RV/123/20)";
      const output = sanitizeProviderImageMarkupToAlt(input);
      expect(output).toBe("Check Tabelle, Web, Relativ and [Link](https://findok.bmf.gv.at/findok/volltext?gz=RV/123/20)");
    });
  });
});
