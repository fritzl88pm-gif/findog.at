// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import FredArtifactCards from "./fred-artifact-cards";

describe("FredArtifactCards download", () => {
  afterEach(() => vi.restoreAllMocks());

  it("clicks an attached anchor and revokes the blob URL only after the click has run", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let connectedAtClick = false;
    let revokedInSameTask = true;
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      connectedAtClick = this.isConnected;
      // Runs right after the synchronous rest of the download handler.
      queueMicrotask(() => { revokedInSameTask = revoke.mock.calls.length > 0; });
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    await act(async () => createRoot(container).render(<FredArtifactCards accessToken="jwt-123" conversationId="conv" messageId={9} artifacts={[
      { id: "a", fileName: "Bericht.pptx", fileSize: 3, fileType: ".pptx", upstreamIndex: 0 },
    ]} />));

    const button = container.querySelector('[aria-label="Bericht.pptx herunterladen"]') as HTMLButtonElement;
    await act(async () => button.click());

    expect(connectedAtClick).toBe(true);
    expect(revokedInSameTask).toBe(false);
    expect(document.querySelector("a")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoke).toHaveBeenCalledWith("blob:fixture");
  });
});
