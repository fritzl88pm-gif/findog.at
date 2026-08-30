import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findNearestPrecedingUserMessage } from "./agent-feedback";

const viewSource = readFileSync(
  fileURLToPath(new URL("../components/fred-native-chat-view.tsx", import.meta.url)),
  "utf8",
);
const adminSource = readFileSync(
  fileURLToPath(new URL("../components/admin-feedback-view.tsx", import.meta.url)),
  "utf8",
);
const pageSource = readFileSync(
  fileURLToPath(new URL("../app/page.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

describe("findNearestPrecedingUserMessage", () => {
  it("finds the user message belonging to an assistant answer", () => {
    const messages = [
      { role: "user" as const, content: "Frage 1" },
      { role: "assistant" as const, content: "Antwort 1" },
      { role: "user" as const, content: "Frage 2" },
      { role: "assistant" as const, content: "Antwort 2" },
    ];
    expect(findNearestPrecedingUserMessage(messages, 1)).toBe("Frage 1");
    expect(findNearestPrecedingUserMessage(messages, 3)).toBe("Frage 2");
  });

  it("returns null without a preceding user message", () => {
    expect(findNearestPrecedingUserMessage([
      { role: "assistant", content: "Antwort" },
    ], 0)).toBeNull();
  });
});

describe("Fred feedback UI", () => {
  it("renders both thumb actions below completed assistant answers", () => {
    expect(viewSource).toContain('className="fred-feedback"');
    expect(viewSource).toContain('aria-label="Antwort hilfreich"');
    expect(viewSource).toContain('aria-label="Antwort nicht korrekt"');
    expect(viewSource).toContain("positiveFeedbackIndexes.has(index)");
    expect(viewSource).toContain("feedbackTargetIndex === index");
    expect(cssSource).toContain(".feedback-positive.is-active");
    expect(cssSource).toContain(".feedback-negative.is-active");
  });

  it("keeps positive feedback local and persists only the negative explanation", () => {
    const positiveHandler = viewSource.slice(
      viewSource.indexOf("function togglePositiveFeedback"),
      viewSource.indexOf("function openNegativeFeedback"),
    );
    const negativeHandler = viewSource.slice(
      viewSource.indexOf("async function submitNegativeFeedback"),
      viewSource.indexOf("async function loadReasoningCategories"),
    );
    expect(positiveHandler).not.toContain("fetch(");
    expect(negativeHandler).toContain('fetch("/api/feedback"');
    expect(negativeHandler).toContain("assistantResponse: message.content");
    expect(viewSource).toContain("Warum ist diese Antwort nicht korrekt?");
    expect(viewSource).toContain("Rückmeldung senden");
  });
});

describe("admin feedback UI", () => {
  it("adds a keyboard-reachable feedback tab and loads the protected endpoint", () => {
    expect(pageSource).toContain('"scanning", "benutzer", "feedback", "downloads", "dashboard-news", "openrouter"');
    expect(pageSource).toContain('id="admin-tab-feedback"');
    expect(pageSource).toMatch(/>\s*Rückmeldungen\s*<\/button>/u);
    expect(pageSource).toContain("<AdminFeedbackView");
    expect(adminSource).toContain('fetch("/api/admin/feedback"');
    expect(adminSource).toContain("Negative Fred-Rückmeldungen");
  });

  it("shows the report first and keeps question and answer expandable", () => {
    expect(adminSource).toContain("entry.feedback");
    expect(adminSource).toContain("<details>");
    expect(adminSource).toContain("entry.userRequest");
    expect(adminSource).toContain("entry.assistantResponse");
    expect(cssSource).toContain(".admin-feedback-list");
  });
});
