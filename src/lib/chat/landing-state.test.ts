import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8",
);
const fredViewSource = readFileSync(
  fileURLToPath(new URL("../../components/fred-native-chat-view.tsx", import.meta.url)),
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
  it("starts fresh and loads only durable Fred history", () => {
    expect(pageSource).not.toContain("chatHistoryStorageKey");
    expect(pageSource).toContain("authenticatedUserIdRef");
    expect(pageSource).toContain('fetch("/api/fred/conversations"');
    expect(pageSource).not.toContain('fetch("/api/conversations"');
    expect(pageSource).toMatch(/async function selectFredConversation[\s\S]*?fetchFredConversationHistory/);
  });

  it("keeps the empty landing reset scoped to a newly authenticated user", () => {
    expect(pageSource).toMatch(
      /const isFreshAuthenticatedLanding\s*=\s*authenticatedUserIdRef\.current\s*!==\s*user\.id/,
    );
    expect(pageSource).toMatch(/if \(isFreshAuthenticatedLanding\) \{[\s\S]*?setAppView\("chat"\)[\s\S]*?setFredConversationId\(""\)[\s\S]*?setFredMessages\(\[\]\)/);
  });

  it("renders Fred, one greeting, and the existing composer as a centered group", () => {
    const groupStart = fredViewSource.indexOf('<div className="chat-content-group">');
    const groupEnd = fredViewSource.lastIndexOf("</section>");
    const group = fredViewSource.slice(groupStart, groupEnd);

    expect(groupStart).toBeGreaterThanOrEqual(0);
    expect(group).toContain('src="/fred.png"');
    expect(group).toContain('alt="Fred, der Findog-Steuerassistent"');
    expect(group).toContain("welcomeGreeting");
    expect(group).toContain('<form className="composer"');
    expect(fredViewSource.match(/<form className="composer"/g)).toHaveLength(1);
    expect(fredViewSource).not.toContain("Neue Anfrage");
    expect(fredViewSource).not.toContain(
      "Stelle eine konkrete steuerrechtliche Frage mit Sachverhalt und Zeitraum.",
    );
    const emptyPanelRule = cssRule(".chat-panel.empty-chat");
    const emptyContentRule = cssRule(".empty-chat .chat-content-group");
    const emptyComposerRule = cssRule(".empty-chat .composer-container");
    const emptyStateRule = cssRule(".empty-state");
    const fredRule = cssRule(".fred-welcome-image");
    const greetingRule = cssRule(".welcome-greeting");

    expect(emptyPanelRule).toMatch(/justify-content:\s*center/);
    expect(emptyContentRule).toMatch(/align-items:\s*center/);
    expect(emptyContentRule).not.toMatch(/margin:\s*auto/);
    expect(emptyComposerRule).not.toMatch(/margin:\s*auto/);
    expect(emptyStateRule).toMatch(/display:\s*flex/);
    expect(emptyStateRule).toMatch(/flex-direction:\s*row/);
    expect(emptyStateRule).toMatch(/align-items:\s*center/);
    expect(emptyStateRule).toMatch(/justify-content:\s*center/);
    expect(fredRule).toMatch(/flex:\s*0\s+1\s+auto/);
    expect(greetingRule).toMatch(/flex:\s*0\s+1\s+auto/);
    expect(greetingRule).toMatch(/min-width:\s*0/);
    expect(stylesSource.match(/\.empty-state\s*\{[^}]*\}/g)).not.toContainEqual(
      expect.stringMatching(/flex-direction:\s*column/),
    );
  });
});
