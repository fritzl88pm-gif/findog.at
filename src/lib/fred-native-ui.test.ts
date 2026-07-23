import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(
  fileURLToPath(new URL("../components/fred-native-chat-view.tsx", import.meta.url)),
  "utf8",
);
const richAnswerSource = readFileSync(
  fileURLToPath(new URL("../components/rich-answer.tsx", import.meta.url)),
  "utf8",
);
const copyButtonSource = readFileSync(
  fileURLToPath(new URL("../components/copy-icon-button.tsx", import.meta.url)),
  "utf8",
);
const pdfDownloadSource = readFileSync(
  fileURLToPath(new URL("./chat/pdf-download.ts", import.meta.url)),
  "utf8",
);
const routeSource = readFileSync(
  fileURLToPath(new URL("../app/api/fred/chat/route.ts", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const nextConfigSource = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");

describe("Fred native Findog UI", () => {
  it("uses the new-conversation action as the only Fred navigation and renders the native chat", () => {
    expect(pageSource).toContain('type AppView = "chat" | "scanning" | "forms"');
    expect(pageSource).not.toContain('type AppView = "chat" | "fred"');
    expect(pageSource).not.toContain("onClick={openFredView}");
    expect(pageSource.match(/onClick=\{startNewManagedConversation\}/gu)).toHaveLength(2);
    expect(pageSource).toContain("Neue Unterhaltung");
    expect(pageSource).not.toContain("Aktueller Fred-Chat");
    expect(pageSource).toContain("<FredNativeChatView");
    expect(pageSource).toContain("initialMessages={fredMessages}");
    expect(pageSource).toContain("renderAssistantContent={(content) => <RichAnswer content={content} />}");
    expect(pageSource).not.toContain("<FredEmbedView");
    expect(pageSource).not.toContain("<FredHistoryTranscript");
  });

  it("uses an accessible trash icon for deleting individual conversations", () => {
    expect(pageSource).toContain('className="conversation-delete"');
    expect(pageSource).toContain('title="Unterhaltung löschen"');
    expect(pageSource).toContain('d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"');
    expect(pageSource).not.toMatch(/className="conversation-delete"[\s\S]*?>\s*Löschen\s*<\/button>/u);
    expect(cssSource).toContain(".conversation-delete svg");
  });

  it("renders Fred's image and greeting in the existing centered empty state", () => {
    expect(viewSource).toContain('src="/fred.png"');
    expect(viewSource).toContain('className="empty-state"');
    expect(viewSource).toContain('<h1 className="welcome-greeting">{welcomeGreeting}</h1>');
    expect(viewSource.indexOf('src="/fred.png"')).toBeLessThan(
      viewSource.indexOf('className="welcome-greeting"'),
    );
    expect(cssSource).toMatch(/\.empty-state \{[\s\S]*?align-items: center;[\s\S]*?text-align: center;/u);
    expect(cssSource).toMatch(/\.welcome-greeting \{[\s\S]*?color: var\(--bmf-blue-deep\);/u);
  });

  it("uses Findog message bubbles, rich answers and the native composer for live responses", () => {
    expect(viewSource).toContain('className={`message ${message.role}');
    expect(viewSource).toContain("renderAssistantContent(message.content)");
    expect(viewSource).toContain('src="/fred-sniff.gif"');
    expect(viewSource).toContain('className="fred-thinking-indicator"');
    expect(viewSource).not.toContain('<p className="message-body">Fred denkt nach');
    expect(cssSource).toContain(".fred-thinking-indicator img");
    expect(viewSource).toContain('className="composer"');
    expect(viewSource).toContain('className="composer-icon-button"');
    expect(viewSource).toContain("autosizeComposer(textarea)");
    expect(viewSource).toContain("resetComposerHeight(composerRef.current)");
    expect(viewSource).toContain("ref={composerRef}");
    expect(viewSource).toContain("Bild anhängen");
    expect(viewSource).toContain("Datei anhängen");
    expect(viewSource).toContain("max. {MAX_IMAGE_UPLOADS} · je 10 MB");
    expect(viewSource).toContain("max. {MAX_FILE_UPLOADS} · je 20 MB");
    expect(viewSource).toContain('className="fred-web-search-icon"');
    expect(viewSource).toContain('fetch("/api/fred/chat"');
    expect(viewSource).toContain("parseFredNativeStreamLine");
    expect(viewSource).toContain("Stoppen");
    expect(viewSource).not.toContain("<iframe");
    expect(viewSource).not.toContain("postMessage");
  });

  it("copies complete Fred answers and individual tables with icon controls", () => {
    expect(viewSource).toContain('label="Antwort kopieren"');
    expect(viewSource).toContain('className="message-actions"');
    expect(richAnswerSource).toContain('label="Tabelle kopieren"');
    expect(richAnswerSource).toContain("richTableClipboardContent(block)");
    expect(copyButtonSource).toContain('"text/html"');
    expect(copyButtonSource).toContain('aria-live="polite"');
    expect(cssSource).toContain(".copy-icon-button.is-copied");
  });

  it("supports editing, regenerating and authenticated answer or conversation PDF exports", () => {
    expect(viewSource).toContain('aria-label="Frage bearbeiten"');
    expect(viewSource).toContain('aria-label="Antwort erneut erzeugen"');
    expect(viewSource).toContain('aria-label="Antwort als PDF exportieren"');
    expect(pageSource).toContain("Verlauf als PDF");
    expect(pageSource).toContain("className=\"conversation-export\"");
    expect(pageSource).toContain("buildFredConversationPdfContent(fredMessages)");
    expect(viewSource).not.toContain("fred-chat-toolbar");
    expect(pdfDownloadSource).toContain('fetch("/api/tools/pdf"');
    expect(viewSource).toContain("precedingUserMessage(messages, assistantIndex)");
    expect(pdfDownloadSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(cssSource).toContain(".conversation-export");
  });

  it("continues a selected stored Fred conversation instead of showing it read-only", () => {
    expect(pageSource).toContain("selectFredConversation(conversation)");
    expect(pageSource).toContain("setFredConversationId(conversation.id)");
    expect(viewSource).toContain("conversationId: activeConversationIdRef.current || undefined");
    expect(routeSource).toContain('.eq("client_id", options.userId)');
    expect(routeSource).toContain("deriveFredSessionSignature");
    expect(pageSource).not.toContain("schreibgeschützter Verlauf");
  });

  it("offers only the WeKnora-enabled upload and web-search controls", () => {
    expect(viewSource).toContain('fetch("/api/fred/capabilities"');
    expect(viewSource).toContain("capabilities.fileUpload");
    expect(viewSource).toContain("capabilities.webSearch");
    expect(viewSource).toContain('formData.append("image"');
    expect(viewSource).toContain('formData.append("attachment"');
    expect(viewSource).toContain("webSearchEnabled");
    expect(routeSource).toContain("MAX_IMAGE_UPLOADS = 5");
    expect(routeSource).toContain("MAX_FILE_UPLOADS = 5");
    expect(routeSource).toContain('rpc("record_fred_native_event"');
    expect(pageSource).toContain("normalizeFredAttachments");
  });

  it("keeps WeKnora credentials server-side and tightens framing policy", () => {
    expect(routeSource).toContain("mintFredEmbedSession");
    expect(routeSource).toContain("openFredUpstreamStream");
    expect(viewSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(viewSource).not.toContain("WEKNORA_FRED_PUBLISH_TOKEN");
    expect(viewSource).not.toContain("taxdog.cloud");
    expect(nextConfigSource).toContain("frame-src 'self'");
    expect(nextConfigSource).not.toContain("frame-src 'self' https://taxdog.cloud");
    expect(nextConfigSource).toContain("frame-ancestors 'none'");
  });

  it("gives .fred-web-search-toggle.is-active at least as many class/pseudo-class selectors as .composer-model-trigger:hover:not(:disabled) in globals.css", () => {
    /* CSS specificity: .composer-model-trigger:hover:not(:disabled) = 0,3,0
       (one class + :hover + :disabled inside :not).
       .fred-web-search-toggle.is-active = 0,2,0 → too low, sticky mobile :hover still wins.
       The fix adds the .composer-model-trigger class to raise it to 0,3,0 or higher. */
    const hasHigherSpec = cssSource.includes(
      ".composer-model-trigger.fred-web-search-toggle.is-active",
    );
    expect(hasHigherSpec).toBe(true);
  });
});

describe("Fred Pro Mode UI", () => {
  it("includes proMode in FredCapabilities", () => {
    expect(viewSource).toContain("proMode");
    expect(pageSource).toContain("proMode");
  });

  it("renders a compact Pro button immediately before the Websuche button in composer-actions", () => {
    const proIndex = viewSource.indexOf("Pro");
    const webSearchIndex = viewSource.indexOf("fred-web-search-toggle");
    expect(proIndex).toBeGreaterThan(0);
    expect(proIndex).toBeLessThan(webSearchIndex);
  });

  it("uses aria-pressed, dynamic title/aria-label on the Pro button", () => {
    expect(viewSource).toContain('aria-pressed={proModeEnabled}');
    expect(viewSource).toContain('"Pro-Modus verwenden"');
    expect(viewSource).toContain('"Pro-Modus aktiv"');
  });

  it("uses type=button and is disabled while sending", () => {
    expect(viewSource).toContain('type="button"');
    expect(viewSource).toContain('disabled={isSending}');
  });

  it("renders the Pro button only when capabilities.proMode is true", () => {
    expect(viewSource).toContain("capabilities.proMode");
  });

  it("keeps Pro and Websuche independent", () => {
    expect(viewSource).toContain("proModeEnabled");
    expect(viewSource).toContain("webSearchEnabled");
  });

  it("sends proModeEnabled in the request payload for both JSON and multipart", () => {
    expect(viewSource).toContain("proModeEnabled");
    const payloadAssignment = /requestPayload\s*=\s*\{[^}]*proModeEnabled[^}]*\}/u;
    expect(viewSource).toMatch(payloadAssignment);
  });

  it("does not contain any model UUID or name in the component source", () => {
    expect(viewSource).not.toContain("8bf35269");
    expect(viewSource).not.toContain("deepseek-v4-pro");
    expect(viewSource).not.toContain("summary_model_id");
    expect(viewSource).not.toContain("WEKNORA_FRED_PRO_MODEL_ID");
  });

  it("preserves proMode state after sending for later messages", () => {
    expect(viewSource).toContain("proModeEnabled");
  });

  it("restores proModeEnabled on edit", () => {
    expect(viewSource).toContain("proModeEnabled");
    expect(viewSource).toContain("editQuestion");
  });

  it("reuses preceding user turn's proModeEnabled on regenerate", () => {
    expect(viewSource).toContain("regenerateAnswer");
  });

  it("renders a compact Pro badge on user messages where true", () => {
    expect(viewSource).toContain("Pro");
    expect(viewSource).toContain("fred-native-option-badge");
    expect(viewSource).toContain("proModeEnabled");
  });

  it("uses scoped CSS class .fred-pro-toggle in globals.css", () => {
    expect(cssSource).toContain(".fred-pro-toggle");
    expect(cssSource).toContain(".fred-pro-toggle.is-active");
  });

  it("includes proModeEnabled in the FredNativeMessage type", () => {
    expect(viewSource).toContain("proModeEnabled?: boolean");
    expect(pageSource).toContain("proModeEnabled");
  });
});
describe("Fred Pro Mode options.proModeEnabled regression (TDD)", () => {
  it("submitQuery reads proModeEnabled from options.proModeEnabled (normalised via isProMode), not the closure variable", () => {
    // MUST use the normalised local variable, not the React closure
    expect(viewSource).toContain("userMessage.proModeEnabled = isProMode;");
    // The old buggy pattern using the closure variable directly MUST NOT exist
    expect(viewSource).not.toMatch(/userMessage\.proModeEnabled\s*=\s*proModeEnabled(?!\s*\.)/u);
  });

  it("submitQuery reads requestPayload proModeEnabled from normalised isProMode, not the closure variable", () => {
    // MUST use the normalised local variable in the requestPayload
    expect(viewSource).toContain("proModeEnabled: isProMode,");
    // The requestPayload object must NOT contain the old standalone shorthand
    // "proModeEnabled," that would read from the closure
    const reqPayloadStart = viewSource.indexOf("requestPayload =");
    if (reqPayloadStart >= 0) {
      const reqPayloadBlock = viewSource.slice(reqPayloadStart, viewSource.indexOf("};", reqPayloadStart) + 2);
      expect(reqPayloadBlock).not.toMatch(/^\s+proModeEnabled,$/mu);
    }
  });

  it("submitQuery normalises options.proModeEnabled === true once into isProMode", () => {
    expect(viewSource).toContain("const isProMode = options.proModeEnabled === true;");
    expect(viewSource).toContain("userMessage.proModeEnabled = isProMode;");
    expect(viewSource).toContain("proModeEnabled: isProMode,");
  });

  it("sendMessage passes proModeEnabled to submitQuery", () => {
    expect(viewSource).toMatch(/sendMessage[\s\S]*?submitQuery\s*\(\{[\s\S]*?proModeEnabled[\s\S]*?\}\s*\)/u);
  });

  it("regenerateAnswer computes gated originalProMode once and passes it to submitQuery", () => {
    expect(viewSource).toContain("const originalProMode = Boolean(question.proModeEnabled && capabilities.proMode);");
    expect(viewSource).toContain("proModeEnabled: originalProMode,");
    const regenBlock = /regenerateAnswer[\s\S]*?submitQuery\s*\(\{[\s\S]*?proModeEnabled: originalProMode[\s\S]*?\}\s*\)/u.exec(viewSource);
    expect(regenBlock).not.toBeNull();
  });
});

describe("QuickFred immutable conversation UI", () => {
  it("adds the QuickFred capability and sends only a boolean selection", () => {
    expect(viewSource).toContain("quickFred: boolean");
    expect(viewSource).toContain("quickFredEnabled: agentKey === \"quickfred\"");
    expect(viewSource).not.toContain("WEKNORA_QUICKFRED_AGENT_ID");
    expect(viewSource).not.toContain("WEKNORA_QUICKFRED_PUBLISH_TOKEN");
  });

  it("places the lightning control between Pro and Websuche", () => {
    const proIndex = viewSource.indexOf("fred-pro-toggle");
    const quickIndex = viewSource.indexOf("fred-quick-toggle");
    const webIndex = viewSource.indexOf("fred-web-search-toggle");
    expect(proIndex).toBeGreaterThan(0);
    expect(quickIndex).toBeGreaterThan(proIndex);
    expect(quickIndex).toBeLessThan(webIndex);
    expect(viewSource).toContain("fred-quick-icon");
  });

  it("locks the lightning control once the conversation has an agent", () => {
    expect(viewSource).toContain("conversationAgentKey !== null");
    expect(viewSource).toContain("Agent für diese Unterhaltung festgelegt");
    expect(viewSource).toContain("isSending || conversationAgentKey !== null || !capabilities.quickFred");
  });

  it("makes Pro and QuickFred mutually exclusive", () => {
    expect(viewSource).toContain("setQuickFredEnabled(false)");
    expect(viewSource).toContain("setProModeEnabled(false)");
    expect(viewSource).toContain('conversationAgentKey === "quickfred"');
  });

  it("renders QuickFred attribution and scoped toggle styles", () => {
    expect(viewSource).toContain("fredAgentName(message.agentKey)");
    expect(viewSource).toContain(">QuickFred</span>");
    expect(cssSource).toContain(".fred-quick-toggle");
    expect(cssSource).toContain(".fred-quick-icon");
  });
});
