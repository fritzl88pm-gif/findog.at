import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExecutionTimeline } from "./fred-execution-view";
import type { FredExecutionStep } from "@/lib/fred/execution-trace";

const steps: FredExecutionStep[] = [
  { id: "analysis:phase", kind: "analysis", status: "completed", label: "Anfrage analysiert" },
  {
    id: "thinking:a:1",
    kind: "thinking",
    status: "completed",
    label: "Gedankengang",
    detail: "Ich prüfe <b>§ 16 Abs. 1 Z 6 EStG</b>.\nDann suche ich die Richtlinie.",
    afterId: "analysis:phase",
  },
];

describe("ExecutionTimeline Gedankengang", () => {
  const html = renderToStaticMarkup(<ExecutionTimeline steps={steps} />);

  it("renders a collapsed, expandable 'Gedankengang' block", () => {
    expect(html).toContain("Gedankengang");
    expect(html).toContain('<details class="fred-exec-fold">');
    expect(html).not.toMatch(/<details[^>]*\sopen/u);
    expect(html).toContain('class="fred-exec-thinking"');
  });

  it("shows the text as plain text, never as markup", () => {
    expect(html).toContain("&lt;b&gt;§ 16 Abs. 1 Z 6 EStG&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("does not count thinking blocks as steps in the overview", () => {
    expect(html).toContain("<strong>1</strong> Schritt<");
  });

  it("renders nothing extra for traces without thinking steps", () => {
    const plain = renderToStaticMarkup(<ExecutionTimeline steps={[steps[0]]} />);
    expect(plain).not.toContain("Gedankengang");
    expect(plain).not.toContain("fred-exec-thinking");
  });
});
