import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8",
);
const stylesSource = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stylesSource.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("assistant identity", () => {
  it("uses Fred's decorative public avatar and exact sender name in messages and pending state", () => {
    expect(
      pageSource.match(/<img className="message-avatar fred-avatar" src="\/fred-avatar\.png" alt="" \/>/g),
    ).toHaveLength(2);
    expect(pageSource.match(/<span className="sender-name">Fred<\/span>/g)).toHaveLength(2);
    expect(pageSource).not.toContain("Findog/Fred");
    expect(pageSource).not.toMatch(/>FF</);
    expect(pageSource).toContain('<div className="message-avatar">DU</div>');
  });

  it("keeps the user avatar at 24px while making only Fred's avatar larger and cropped", () => {
    const baseAvatarRule = cssRule(".message-avatar");
    const fredAvatarRule = cssRule(".fred-avatar");

    expect(baseAvatarRule).toMatch(/width:\s*24px/);
    expect(baseAvatarRule).toMatch(/height:\s*24px/);
    expect(fredAvatarRule).toMatch(/width:\s*(?:2[5-9]|[3-9]\d)px/);
    expect(fredAvatarRule).toMatch(/height:\s*(?:2[5-9]|[3-9]\d)px/);
    expect(fredAvatarRule).toMatch(/border-radius:\s*50%/);
    expect(fredAvatarRule).toMatch(/object-fit:\s*cover/);
  });
});
