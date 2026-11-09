import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RichAnswer from "./rich-answer";

function render(content: string): string {
  return renderToStaticMarkup(React.createElement(RichAnswer, { content }));
}

describe("RichAnswer placeholder highlighting", () => {
  it("highlights placeholders like [Datum] and [Betrag]", () => {
    const html = render("Der Bescheid vom [Datum] über [Betrag] € wird angefochten.");

    expect(html).toContain('<mark class="answer-placeholder" title="Platzhalter – bitte ersetzen">[Datum]</mark>');
    expect(html).toContain('<mark class="answer-placeholder" title="Platzhalter – bitte ersetzen">[Betrag]</mark>');
    expect(html).toContain("wird angefochten.");
  });

  it("highlights placeholders inside bold text and list items", () => {
    const html = render("- **Antragsteller:** [Name des Beschwerdeführers]");

    expect(html).toContain(">[Name des Beschwerdeführers]</mark>");
  });

  it("leaves quote omissions, paragraph brackets and links alone", () => {
    const html = render("Zitat [...] laut [§ 4] und [Link](https://findog.at).");

    expect(html).not.toContain("answer-placeholder");
    expect(html).toContain("<a href=\"https://findog.at\"");
  });
});
