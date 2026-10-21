import { describe, expect, it } from "vitest";
import { splitPlaceholders } from "./reasoning-placeholders";

const placeholders = (text: string) =>
  splitPlaceholders(text)
    .filter((segment) => segment.type === "placeholder")
    .map((segment) => segment.value);

describe("splitPlaceholders", () => {
  it("marks simple and annotated bracket placeholders", () => {
    expect(placeholders("Am [Datum] in [Ort] wurde [zu ergänzen: Vorbringen] eingebracht.")).toEqual([
      "[Datum]",
      "[Ort]",
      "[zu ergänzen: Vorbringen]",
    ]);
  });

  it("keeps nested brackets inside one optional placeholder", () => {
    const segments = splitPlaceholders("X [Optional: Ihr Einwand, [zu ergänzen: Vorbringen], steht dem nicht entgegen.] Y");
    expect(segments).toEqual([
      { type: "text", value: "X " },
      {
        type: "placeholder",
        value: "[Optional: Ihr Einwand, [zu ergänzen: Vorbringen], steht dem nicht entgegen.]",
        optional: true,
      },
      { type: "text", value: " Y" },
    ]);
  });

  it("ignores quote ellipses, markdown links and unclosed brackets", () => {
    expect(placeholders("Zitat [...] und […] sowie [Link](https://findog.at) und [offen")).toEqual([]);
  });

  it("round-trips the original text unchanged", () => {
    const text = "Bescheid vom [Datum]: [Optional, wenn zutreffend: Satz.] Ende [...]";
    expect(splitPlaceholders(text).map((segment) => segment.value).join("")).toBe(text);
  });
});
