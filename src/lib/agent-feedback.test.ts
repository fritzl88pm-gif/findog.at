import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findNearestPrecedingUserMessage } from "./agent-feedback";

const pageSource = readFileSync(
  fileURLToPath(new URL("../app/page.tsx", import.meta.url)),
  "utf8",
);

const cssSource = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

describe("findNearestPrecedingUserMessage", () => {
  it("returns the preceding user message content for adjacent user-assistant pairs", () => {
    const messages = [
      { role: "user" as const, content: "Frage 1" },
      { role: "assistant" as const, content: "Antwort 1" },
      { role: "user" as const, content: "Frage 2" },
      { role: "assistant" as const, content: "Antwort 2" },
    ];
    expect(findNearestPrecedingUserMessage(messages, 1)).toBe("Frage 1");
    expect(findNearestPrecedingUserMessage(messages, 3)).toBe("Frage 2");
  });

  it("skips assistant messages when walking backwards for the nearest user message", () => {
    const messages = [
      { role: "user" as const, content: "Frage 1" },
      { role: "assistant" as const, content: "Antwort 1" },
      { role: "assistant" as const, content: "Antwort 1b" },
      { role: "assistant" as const, content: "Antwort 1c" },
    ];
    expect(findNearestPrecedingUserMessage(messages, 3)).toBe("Frage 1");
  });

  it("returns null when no preceding user message exists", () => {
    const messages = [
      { role: "assistant" as const, content: "Willkommen" },
    ];
    expect(findNearestPrecedingUserMessage(messages, 0)).toBeNull();
  });

  it("returns null for an empty messages array or missing index", () => {
    expect(findNearestPrecedingUserMessage([], 0)).toBeNull();
  });
});

describe("feedback UI contract", () => {
  it("renders feedback controls only for assistant messages", () => {
    // The feedback-controls div is within a block conditioned on role === "assistant"
    const feedbackControlsPos = pageSource.indexOf("feedback-controls");
    expect(feedbackControlsPos).toBeGreaterThan(-1);

    // Find where feedback-controls appears and verify it's preceded by an assistant condition
    const assistantCheckPattern = /message\.role === "assistant" && findNearestPrecedingUserMessage/g;
    const assistantMatches = [...pageSource.matchAll(assistantCheckPattern)];
    expect(assistantMatches.length).toBeGreaterThanOrEqual(1);

    const lastCheck = assistantMatches[assistantMatches.length - 1];
    expect(lastCheck.index).toBeLessThan(feedbackControlsPos);

    const afterCondition = pageSource.slice(
      lastCheck.index,
      lastCheck.index + 2000,
    );
    expect(afterCondition).toContain("feedback-controls");

    // Verify .feedback-controls does NOT appear inside a user role condition block
    const userConditionPos = pageSource.indexOf('message.role === "user"');
    expect(userConditionPos).toBeGreaterThan(-1);
    const userBlockAfter = pageSource.slice(userConditionPos, userConditionPos + 500);
    expect(userBlockAfter).not.toContain("feedback-controls");
  });

  it("contains the exact thank-you copy 'Danke für dein Feedback' in the positive feedback dialog", () => {
    expect(pageSource).toContain("Danke für dein Feedback");

    // Verify it's inside the positive dialog section
    const positiveDialogStart = pageSource.lastIndexOf(
      'feedbackDialogType === "positive"',
    );
    const positiveDialogSection = pageSource.slice(
      positiveDialogStart,
      positiveDialogStart + 1000,
    );
    expect(positiveDialogSection).toContain("Danke für dein Feedback");
  });

  it("uses green/red class semantics for positive/negative feedback buttons", () => {
    // The thumbs-up button uses feedback-positive class
    const thumbsUpMatch = pageSource.match(
      /className="feedback-button feedback-positive"/,
    );
    expect(thumbsUpMatch).not.toBeNull();

    // The thumbs-down button uses feedback-negative class
    const thumbsDownMatch = pageSource.match(
      /className="feedback-button feedback-negative"/,
    );
    expect(thumbsDownMatch).not.toBeNull();

    // CSS has green background for .feedback-positive and red for .feedback-negative
    expect(cssSource).toContain(".feedback-positive");
    expect(cssSource).toContain(".feedback-negative");

    // Verify green background color for positive
    const positiveBlock = cssSource.slice(
      cssSource.indexOf(".feedback-positive"),
      cssSource.indexOf(".feedback-positive") + 200,
    );
    expect(positiveBlock).toMatch(/background/);
    expect(positiveBlock).toMatch(/#2e7d32|green/i);

    // Verify red background color for negative
    const negativeBlock = cssSource.slice(
      cssSource.indexOf(".feedback-negative"),
      cssSource.indexOf(".feedback-negative") + 200,
    );
    expect(negativeBlock).toMatch(/background/);
    expect(negativeBlock).toMatch(/#c62828|red/i);
  });

  it("does not persist positive feedback via API call", () => {
    // The positive dialog section should NOT contain any fetch call
    const positiveDialogStart = pageSource.indexOf(
      'feedbackDialogType === "positive"',
    );
    const positiveDialogSection = pageSource.slice(
      positiveDialogStart,
      positiveDialogStart + 1000,
    );
    expect(positiveDialogSection).not.toContain("fetch(");
    expect(positiveDialogSection).not.toContain("fetch (");

    // verify the submitFeedback function does the fetch for negative feedback
    const submitFeedbackFn = pageSource.slice(
      pageSource.indexOf("async function submitFeedback"),
      pageSource.indexOf("async function submitFeedback") + 2000,
    );
    expect(submitFeedbackFn).toContain('fetch("/api/feedback"');

    // The positive button's onClick should only setFeedbackDialogType("positive"),
    // not call submitFeedback
    const thumbsUpOnClick = pageSource.match(
      /setFeedbackTargetIndex\(index\).*setFeedbackDialogType\("positive"\)/s,
    );
    expect(thumbsUpOnClick).not.toBeNull();
  });

  it("stores the exact feedback trigger for both thumb buttons", () => {
    expect(pageSource).toContain(
      "const feedbackTriggerRef = useRef<HTMLButtonElement>(null);",
    );
    expect(
      pageSource.match(/feedbackTriggerRef\.current = event\.currentTarget;/g),
    ).toHaveLength(2);
  });

  it("assigns and focuses the active feedback dialog", () => {
    expect(pageSource).toContain(
      "const feedbackDialogRef = useRef<HTMLElement>(null);",
    );
    expect(pageSource.match(/ref=\{feedbackDialogRef\}/g)).toHaveLength(2);
    expect(pageSource).toContain("feedbackCloseRef.current?.focus();");
    expect(pageSource).toContain("feedbackTextareaRef.current?.focus();");
  });

  it("traps Tab navigation and guards Escape while feedback is saving", () => {
    const feedbackEffectStart = pageSource.indexOf(
      "if (feedbackTargetIndex === null)",
    );
    const feedbackEffect = pageSource.slice(
      feedbackEffectStart,
      feedbackEffectStart + 2500,
    );

    expect(feedbackEffect).toContain('event.key === "Escape"');
    expect(feedbackEffect).toContain("!isFeedbackSaving");
    expect(feedbackEffect).toContain("closeFeedbackDialog();");
    expect(feedbackEffect).toContain('event.key !== "Tab"');
    expect(feedbackEffect).toContain("feedbackDialogRef.current");
    expect(feedbackEffect).toContain("event.shiftKey");
    expect(feedbackEffect).toContain("event.preventDefault();");
    expect(feedbackEffect).toContain("firstFocusable.focus();");
    expect(feedbackEffect).toContain("lastFocusable.focus();");
  });

  it("routes every feedback dismissal through the shared close helper", () => {
    const dialogMarkup = pageSource.slice(
      pageSource.indexOf("{feedbackTargetIndex !== null ? ("),
      pageSource.indexOf('<div className="composer-container">'),
    );

    expect(dialogMarkup).toMatch(
      /event\.target === event\.currentTarget[\s\S]*?closeFeedbackDialog\(\);/,
    );
    expect(dialogMarkup.match(/onClick=\{closeFeedbackDialog\}/g)).toHaveLength(3);
    expect(dialogMarkup).not.toContain("setFeedbackTargetIndex(null)");
  });

  it("restores trigger focus only after the guarded shared close path", () => {
    const closeHelper = pageSource.slice(
      pageSource.indexOf("const closeFeedbackDialog"),
      pageSource.indexOf("async function submitFeedback"),
    );

    expect(closeHelper).toContain("if (isFeedbackSaving)");
    expect(closeHelper).toContain("setFeedbackTargetIndex(null);");
    expect(closeHelper).toContain('setFeedbackError("");');
    expect(closeHelper).toContain("feedbackTriggerRef.current?.focus()");
    expect(closeHelper).not.toContain("setFeedbackText");
    expect(pageSource).not.toContain("feedbackButtonRefs");
  });
});

describe("CSS regression: feedback rules outside reduced-motion block", () => {
  it("places .feedback-controls outside @media (prefers-reduced-motion: reduce)", () => {
    // Find the reduced-motion media block
    const mediaStart = cssSource.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaStart).toBeGreaterThan(-1);

    // Find where the media block ends: find matching } brace
    let depth = 0;
    let inBlock = false;
    let blockEnd = mediaStart;
    for (let i = mediaStart; i < cssSource.length; i++) {
      if (cssSource[i] === "{") {
        depth++;
        inBlock = true;
      } else if (cssSource[i] === "}") {
        depth--;
        if (inBlock && depth === 0) {
          blockEnd = i;
          break;
        }
      }
    }

    // .feedback-controls should appear AFTER the media block
    const fbControlsPos = cssSource.indexOf(".feedback-controls");
    expect(fbControlsPos).toBeGreaterThan(blockEnd);
  });
});
