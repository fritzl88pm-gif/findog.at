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

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stylesSource.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("authenticated empty-chat landing", () => {
  it("starts fresh without restoring or auto-opening locally stored chat history", () => {
    expect(pageSource).not.toContain("readJson<Partial<StoredHistory>>");
    expect(pageSource).toContain("authenticatedUserIdRef");
    expect(pageSource).toContain("removeStoredValue(chatHistoryStorageKey(user.id))");
    expect(pageSource).toContain('fetch("/api/conversations"');
    expect(pageSource).toMatch(/async function selectConversation[\s\S]*?fetchConversationHistory/);
  });

  it("keeps the empty landing reset scoped to a newly authenticated user", () => {
    expect(pageSource).toMatch(
      /const isFreshAuthenticatedLanding\s*=\s*authenticatedUserIdRef\.current\s*!==\s*user\.id/,
    );
    expect(pageSource).toMatch(/if \(isFreshAuthenticatedLanding\) \{[\s\S]*?setConversationId\(""\)[\s\S]*?setComposer\(""\)[\s\S]*?clearAttachments\(\)/);
  });

  it("renders Fred, one greeting, and the existing composer as a centered group", () => {
    const groupStart = pageSource.indexOf('<div className="chat-content-group">');
    const groupEnd = pageSource.lastIndexOf("</section>");
    const group = pageSource.slice(groupStart, groupEnd);

    expect(groupStart).toBeGreaterThanOrEqual(0);
    expect(group).toContain('src="/fred.png"');
    expect(group).toContain('alt="Fred, der Findog-Steuerassistent"');
    expect(group).toContain("welcomeGreeting");
    expect(group).toContain('<form className="composer"');
    expect(pageSource.match(/<form className="composer"/g)).toHaveLength(1);
    expect(pageSource).not.toContain("Neue Anfrage");
    expect(pageSource).not.toContain(
      "Stelle eine konkrete steuerrechtliche Frage mit Sachverhalt und Zeitraum.",
    );
    const emptyPanelRule = cssRule(".chat-panel.empty-chat");
    const emptyContentRule = cssRule(".empty-chat .chat-content-group");
    const emptyComposerRule = cssRule(".empty-chat .composer-container");

    expect(emptyPanelRule).toMatch(/justify-content:\s*center/);
    expect(emptyContentRule).toMatch(/align-items:\s*center/);
    expect(emptyContentRule).not.toMatch(/margin:\s*auto/);
    expect(emptyComposerRule).not.toMatch(/margin:\s*auto/);
  });
});
