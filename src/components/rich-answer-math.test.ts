import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RichAnswer from "./rich-answer";

describe("RichAnswer math rendering", () => {
  it("renders the reported Fred calculation through KaTeX", () => {
    const html = renderToStaticMarkup(React.createElement(RichAnswer, {
      content: "Daher:\n\n\\[150\\,€ + 150\\,€ = \\boxed{300\\,€}\\]",
    }));

    expect(html).toContain("answer-math-block");
    expect(html).toContain("katex");
    expect(html).toContain('menclose notation="box"');
  });

  it("renders inline math and preserves ordinary currency text", () => {
    const html = renderToStaticMarkup(React.createElement(RichAnswer, {
      content: "Formel \\(x^2\\), Preis 150 € und $100.",
    }));

    expect(html).toContain("answer-math-inline");
    expect(html).toContain("katex");
    expect(html).toContain("Preis 150 € und $100.");
  });

  it("does not trust dangerous KaTeX commands", () => {
    const html = renderToStaticMarkup(React.createElement(RichAnswer, {
      content: "\\[\\href{javascript:alert(1)}{x}<script>alert(1)</script>\\]",
    }));

    expect(html).toContain("katex");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<script>");
  });
});
