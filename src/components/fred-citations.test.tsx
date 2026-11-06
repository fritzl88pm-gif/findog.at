import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RichAnswer from "./rich-answer";
import { CitedSourceEntry, FredCitationScope } from "./fred-citations";

const cited = [
  { kind: "knowledge" as const, doc: "DBA_Deutschland_Fassung_2026-07-13.md" },
  { kind: "web" as const, url: "https://example.test/seite", title: "Seite" },
];

function scoped(messageId: number | undefined, child: React.ReactNode): string {
  return renderToStaticMarkup(
    <FredCitationScope
      accessToken="token"
      conversationId="22222222-2222-4222-8222-222222222222"
      messageId={messageId}
      citedSources={cited}
    >
      {child}
    </FredCitationScope>,
  );
}

function entry(props: { doc: string; fallback: React.ReactNode; label: string }) {
  return <CitedSourceEntry entry={{ doc: props.doc }} fallback={props.fallback}>{props.label}</CitedSourceEntry>;
}

describe("citation markers in rich answers", () => {
  it("renders plain [n] outside a message scope (share page, copy-free surfaces)", () => {
    const html = renderToStaticMarkup(<RichAnswer content="Satz⟦1⟧." />);
    expect(html).toContain("[1]");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("⟦");
  });

  it("renders a superscript button for a knowledge source in a stored message", () => {
    const html = scoped(7, <RichAnswer content="Satz⟦1⟧." />);
    expect(html).toMatch(/<sup class="fred-cite"><button[^>]*aria-haspopup="dialog"[^>]*>1<\/button><\/sup>/u);
    expect(html).toContain("DBA Deutschland Fassung 13.07.2026 anzeigen");
    expect(html).not.toContain("⟦");
  });

  it("opens web sources as links in a new tab", () => {
    const html = scoped(7, <RichAnswer content="Satz⟦2⟧." />);
    expect(html).toContain('href="https://example.test/seite"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("is not clickable before the message has an id, and falls back for unknown numbers", () => {
    const html = scoped(undefined, <RichAnswer content="A⟦1⟧ B⟦9⟧" />);
    expect(html).not.toContain("<button");
    expect(html).toContain("fred-cite-static");
    expect(html).toContain("[9]");
  });
});

describe("cited source list entries", () => {
  it("only cited knowledge sources become buttons; others render unchanged", () => {
    const html = scoped(7, <>
      {entry({ doc: "DBA_Deutschland_Fassung_2026-07-13.md", fallback: <span>x</span>, label: "DBA" })}
      {entry({ doc: "Nicht_zitiert.md", fallback: <span className="plain">Nicht zitiert</span>, label: "Nicht zitiert" })}
    </>);
    expect(html).toContain('class="fred-source-cite"');
    expect(html).toContain('<span class="plain">Nicht zitiert</span>');
    expect(html.match(/<button/gu)).toHaveLength(1);
  });

  it("renders the fallback outside a scope", () => {
    const html = renderToStaticMarkup(entry({ doc: "A.md", fallback: <span>A</span>, label: "A" }));
    expect(html).toBe("<span>A</span>");
  });
});
