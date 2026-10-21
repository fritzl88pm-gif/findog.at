export type PlaceholderSegment =
  | { type: "text"; value: string }
  | { type: "placeholder"; value: string; optional: boolean };

const ELLIPSIS = /^\[\s*(\.{2,}|…)\s*\]$/;
const OPTIONAL = /^\[\s*optional\b/i;

/**
 * Splits reasoning text into plain text and bracket placeholders such as
 * "[Datum]" or "[zu ergänzen: …]". Nested brackets stay inside the outer
 * placeholder. Quote ellipses ("[...]", "[…]") and Markdown links
 * ("[text](url)") are left as plain text.
 */
export function splitPlaceholders(text: string): PlaceholderSegment[] {
  const segments: PlaceholderSegment[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      segments.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    if (text[i] !== "[") {
      buffer += text[i];
      i += 1;
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (ch === "\n") break;
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      buffer += text[i];
      i += 1;
      continue;
    }

    const token = text.slice(i, end + 1);
    const isLink = text[end + 1] === "(";
    if (isLink || ELLIPSIS.test(token) || token.length <= 2) {
      buffer += token;
    } else {
      flush();
      segments.push({ type: "placeholder", value: token, optional: OPTIONAL.test(token) });
    }
    i = end + 1;
  }

  flush();
  return segments;
}
