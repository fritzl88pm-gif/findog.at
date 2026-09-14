import FredArtifactCards from "@/components/fred-artifact-cards";

/** Local-only render fixture for desktop/mobile visual checks; it is not a production route. */
export default function FredArtifactCardsFixture() {
  return <main style={{ maxWidth: 560, padding: 24 }}>
    <h1>Fred generated downloads · fixture</h1>
    <FredArtifactCards
      accessToken="fixture-access-token"
      conversationId="33333333-3333-4333-8333-333333333333"
      messageId={42}
      artifacts={[
        { id: "txt", fileName: "notiz.txt", fileSize: 12, fileType: ".txt", upstreamIndex: 3 },
        { id: "pdf", fileName: "bericht.pdf", fileSize: 2048, fileType: ".pdf", upstreamIndex: 7 },
      ]}
    />
  </main>;
}
