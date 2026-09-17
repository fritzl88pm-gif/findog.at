import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RichAnswer from "./rich-answer";

describe("RichAnswer link rendering", () => {
  it("renders the reported Google Maps answer link as an anchor", () => {
    const html = renderToStaticMarkup(React.createElement(RichAnswer, {
      content: "Strecke Eggenburg → Wien.\n\n[Route in Google Maps öffnen](https://www.google.com/maps/dir/Eggenburg,+Austria/Wien,+Austria)",
    }));

    expect(html).toMatch(
      /<a href="https:\/\/www\.google\.com\/maps\/dir\/Eggenburg,\+Austria\/Wien,\+Austria"[^>]*><span>Route in Google Maps öffnen<\/span><\/a>/u,
    );
    expect(html).not.toContain("[Route in Google Maps öffnen]");
  });

  it("never renders a non-web scheme as an anchor", () => {
    const html = renderToStaticMarkup(React.createElement(RichAnswer, {
      content: "[script](javascript:alert(1)) und [Kontakt](mailto:office@example.test)",
    }));

    expect(html).not.toContain("<a ");
  });
});
