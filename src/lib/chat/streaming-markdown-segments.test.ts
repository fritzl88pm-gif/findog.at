import { describe, expect, it } from "vitest";

import { parseRichAnswer } from "@/lib/answer-rendering";
import {
  appendStreamingMarkdown,
  emptyStreamingMarkdown,
  replaceStreamingMarkdown,
} from "@/lib/chat/streaming-markdown-segments";

describe("streaming Markdown segments", () => {
  it("keeps split Markdown syntax active until the parser can style it", () => {
    const open = appendStreamingMarkdown(emptyStreamingMarkdown(), "Text mit **Fett");
    expect(parseRichAnswer(open.tail)).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Text mit **Fett" }],
      },
    ]);

    const closed = appendStreamingMarkdown(open, "** und `Code`");
    expect(parseRichAnswer(closed.tail)).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Text mit " },
          { type: "strong", children: [{ type: "text", text: "Fett" }] },
          { type: "text", text: " und " },
          { type: "code", text: "Code" },
        ],
      },
    ]);
  });

  it("commits one boundary split across two deltas", () => {
    const beforeBoundary = appendStreamingMarkdown(emptyStreamingMarkdown(), "Erster Block\n");
    const afterBoundary = appendStreamingMarkdown(beforeBoundary, "\nZweiter Block");

    expect(afterBoundary).toEqual({
      completed: ["Erster Block\n\n"],
      tail: "Zweiter Block",
    });
  });

  it("commits multiple complete blocks in order", () => {
    const state = appendStreamingMarkdown(
      emptyStreamingMarkdown(),
      "## Titel\n\n- Eins\n- Zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );

    expect(state).toEqual({
      completed: ["## Titel\n\n", "- Eins\n- Zwei\n\n"],
      tail: "| A | B |\n|---|---|\n| 1 | 2 |",
    });
  });

  it("keeps consecutive blank lines with the preceding segment", () => {
    const state = appendStreamingMarkdown(
      emptyStreamingMarkdown(),
      "Erster Block\n\n\n\nZweiter Block",
    );

    expect(state).toEqual({
      completed: ["Erster Block\n\n\n\n"],
      tail: "Zweiter Block",
    });
  });

  it("drops leading blank boundaries instead of rendering empty segments", () => {
    const state = appendStreamingMarkdown(emptyStreamingMarkdown(), "\n\nHallo");

    expect(state).toEqual({
      completed: [],
      tail: "Hallo",
    });
  });

  it("keeps an incomplete tail available for a synchronous flush", () => {
    const state = appendStreamingMarkdown(emptyStreamingMarkdown(), "Unvollständig **aber sichtbar");

    expect(state.completed).toEqual([]);
    expect(state.tail).toBe("Unvollständig **aber sichtbar");
  });

  it("replaces settled segments and the active tail", () => {
    const previous = appendStreamingMarkdown(
      emptyStreamingMarkdown(),
      "Alter Block\n\nAlter Rest",
    );

    expect(replaceStreamingMarkdown(previous, "Neuer Block\n\nNeuer Rest")).toEqual({
      completed: ["Neuer Block\n\n"],
      tail: "Neuer Rest",
    });
  });
});
