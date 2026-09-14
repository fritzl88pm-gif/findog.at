// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import FredArtifactCards from "./fred-artifact-cards";

describe("FredArtifactCards", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders genuine type icons and sends Bearer while saving the server filename", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let downloadedFileName = "";
    let downloadedBlob: Blob | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloadedBlob = blob instanceof Blob ? blob : undefined;
      return "blob:fixture";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    await act(async () => createRoot(container).render(<FredArtifactCards accessToken="jwt-123" conversationId="conv" messageId={9} artifacts={[
      { id: "a", fileName: "a.txt", fileSize: 3, fileType: ".txt", upstreamIndex: 4 },
      { id: "b", fileName: "b.pdf", fileSize: 3, fileType: ".pdf", upstreamIndex: 8 },
    ]} />));
    expect(container.textContent).toContain("TXT");
    expect(container.textContent).toContain("PDF");
    const pdfButton = container.querySelector('[aria-label="b.pdf herunterladen"]') as HTMLButtonElement;
    await act(async () => pdfButton.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/fred/conversations/conv/messages/9/artifacts/8", expect.objectContaining({
      headers: { Authorization: "Bearer jwt-123" },
    }));
    expect(downloadedFileName).toBe("b.pdf");
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await downloadedBlob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
