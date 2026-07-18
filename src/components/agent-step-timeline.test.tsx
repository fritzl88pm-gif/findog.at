import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentStep } from "@/lib/agent-steps";
import AgentStepTimeline from "./agent-step-timeline";

describe("AgentStepTimeline", () => {
  it("renders an accessible list with failure and answer markers", () => {
    const steps: AgentStep[] = [
      {
        type: "tool_result",
        title: "Recherchequelle nicht erreichbar",
        content: "Fehler",
        toolName: "search_laws",
        success: false,
      },
      { type: "answer", title: "Finale Antwort", content: "Antwort" },
    ];

    const markup = renderToStaticMarkup(<AgentStepTimeline steps={steps} />);

    expect(markup).toContain('aria-label="Rechercheverlauf"');
    expect(markup).toContain('role="list"');
    expect(markup.match(/class="agent-step-marker"/gu)).toHaveLength(2);
    expect(markup).toContain('class="agent-progress-step is-failure"');
    expect(markup).toContain('class="agent-progress-step is-answer"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain("Recherchequelle nicht erreichbar");
    expect(markup).toContain("Antwort wird erstellt");
  });
});
