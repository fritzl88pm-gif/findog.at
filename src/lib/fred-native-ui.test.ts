import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createStreamingTextBuffer } from "@/lib/chat/streaming-text-buffer";

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
const attachmentValidationSource = readFileSync(
  fileURLToPath(new URL("./attachments/validation.ts", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const nextConfigSource = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");

describe("Fred native Findog UI", () => {
  it("reuses the native transcript in read-only Telegram mode without send paths", () => {
    expect(viewSource).toContain("readOnly?: boolean");
    expect(viewSource).toContain("readOnlyNotice?: string");
    expect(viewSource).toContain("telegramBotUrl?: string");
    expect(viewSource).toContain("{readOnlyNotice}");
    expect(viewSource).toContain("readOnly ? null : (");
    expect(viewSource).toContain("!readOnly && message.role === \"user\"");
    expect(viewSource).toContain("!readOnly && index === messages.length - 1");
    expect(pageSource).toContain("readOnly={activeConversationOrigin === \"telegram\"}");
    expect(pageSource).toContain('readOnlyNotice="Diese Unterhaltung wird in Telegram fortgesetzt."');
    expect(pageSource).not.toContain("fred-telegram-readonly-transcript");
  });

  it("opens only a sanitized active Telegram bot username", () => {
    expect(pageSource).toContain("TELEGRAM_BOT_USERNAME_PATTERN");
    expect(pageSource).toContain("https://t.me/${telegramIntegration.botUsername}");
    expect(pageSource).toContain("status === \"active\"");
    expect(viewSource).toContain('target="_blank"');
    expect(viewSource).toContain('rel="noopener noreferrer"');
    expect(viewSource).toContain("In Telegram öffnen");
  });

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
    expect(viewSource).toContain('className="fred-pro-icon"');
    expect(viewSource).toContain('className="fred-web-search-icon"');
    expect(viewSource).toContain('fetch("/api/fred/chat"');
    expect(viewSource).toContain("parseFredNativeStreamLine");
    expect(viewSource).toContain("Stoppen");
    expect(viewSource).not.toContain("<iframe");
    expect(viewSource).not.toContain("postMessage");
  });

  it("renders live streaming deltas as plain text in a single DOM Text node with pre-wrap and no rich rendering", () => {
    const deltaBranch = /if \(streamEvent\.type === "delta"\) \{([\s\S]*?)\n        \}/u
      .exec(viewSource)?.[1] ?? "";
    expect(deltaBranch).toContain("streamingPreviewRef.current?.append(streamEvent.content)");
    expect(deltaBranch).toContain("answerChunks.push(streamEvent.content)");
    expect(deltaBranch).not.toContain("answer += streamEvent.content");
    expect(deltaBranch).not.toContain("setMessages");
    expect(deltaBranch).not.toContain("renderAssistantContent");
    expect(viewSource).toContain("<StreamingAssistantPreview");
    expect(viewSource).not.toContain("renderAssistantContent={renderAssistantContent}");
    expect(viewSource).not.toContain("memo(function StreamingMarkdownSegment");
    expect(viewSource).not.toContain("renderAssistantContent(segment)");
    expect(viewSource).toContain("document.createTextNode");
    expect(viewSource).toContain("textContainer.replaceChildren(textNode)");
    expect(viewSource).toContain("textNode.appendData(text)");
    expect(viewSource).toContain("textNode.data = text");
    expect(viewSource).toContain("showingStatusRef.current = true");
    expect(viewSource).toContain("showingStatusRef.current = false");
    expect(viewSource).not.toContain("statusText");
    expect(viewSource).not.toContain("dangerouslySetInnerHTML");
    expect(viewSource).toContain("setMessages(baseMessages)");
    // pre-wrap CSS for streaming preview text
    expect(cssSource).toMatch(
      /\.fred-streaming-preview-text \{[\s\S]*?display: block;[\s\S]*?white-space: pre-wrap;/u,
    );
  });

  it("preserves activeConversationIdRef and conversationAgentKey in the final event branch", () => {
    // Fix 6: The final event branch must update the conversation ref and agent key state
    // before constructing and committing completed messages.
    // This is a surgical regression guard — the assignments were accidentally removed.
    const finalBranch = /receivedFinal = true;([\s\S]*?)const completedMessages/u
      .exec(viewSource)?.[1] ?? "";
    expect(finalBranch).toContain("activeConversationIdRef.current = streamEvent.conversation.id");
    expect(finalBranch).toContain("setConversationAgentKey(streamEvent.conversation.agentKey)");
  });

  it("batches streaming text appends and safely flushes replacements and cancellations", () => {
    const appended: string[] = [];
    const replaced: string[] = [];
    const scheduled = new Map<number, () => void>();
    const cancelled: number[] = [];
    let nextFrame = 1;
    const buffer = createStreamingTextBuffer({
      appendText: (text) => appended.push(text),
      replaceText: (text) => replaced.push(text),
      requestFrame: (callback) => {
        const frame = nextFrame;
        nextFrame += 1;
        scheduled.set(frame, callback);
        return frame;
      },
      cancelFrame: (frame) => {
        cancelled.push(frame);
        scheduled.delete(frame);
      },
    });

    buffer.append("Hal");
    buffer.append("lo");
    expect(scheduled.size).toBe(1);
    expect(appended).toEqual([]);
    scheduled.get(1)?.();
    expect(appended).toEqual(["Hallo"]);

    buffer.replace("Neu");
    buffer.append("!");
    buffer.flush();
    expect(replaced).toEqual(["Neu"]);
    expect(appended).toEqual(["Hallo", "!"]);
    expect(cancelled).toContain(2);

    buffer.append("verwerfen");
    buffer.cancel();
    expect(cancelled).toContain(3);
    buffer.flush();
    expect(appended).toEqual(["Hallo", "!"]);
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

  it("saves selected Fred answer text through an accessible context menu and dialog", () => {
    expect(viewSource).toContain('className="fred-assistant-answer"');
    expect(viewSource).toContain("onContextMenu={handleAssistantContextMenu}");
    expect(viewSource).toContain("window.getSelection()");
    expect(viewSource).toContain("event.currentTarget.contains(selection.anchorNode)");
    expect(viewSource).toContain("event.currentTarget.contains(selection.focusNode)");
    expect(viewSource).toContain('role="menu"');
    expect(viewSource).toContain("copyToClipboard(reasoningContextMenu.text)");
    expect(viewSource).toContain("Auswahl kopiert");
    expect(viewSource).toMatch(/>\s*Kopieren\s*<\/button>/u);
    expect(viewSource).toContain("Als Textbaustein speichern");
    expect(viewSource).toContain('role="dialog"');
    expect(viewSource).toContain('aria-modal="true"');
    expect(viewSource).toContain("Vorhandene Kategorie");
    expect(viewSource).toContain("Neue Kategorie anlegen");
    expect(viewSource).toContain("reasoningCategoryLabel(category, reasoningCategories)");
    expect(viewSource).toContain("Abbrechen");
    expect(viewSource).toContain('fetch("/api/reasoning-categories"');
    expect(viewSource).toContain('fetch("/api/reasonings"');
    expect(viewSource).toContain("content: reasoningSaveDraft.text");
    expect(viewSource).toContain("categoryIds: [categoryId]");
    expect(viewSource).toContain("setModeNotice(\"Als Textbaustein gespeichert\")");
    expect(cssSource).toContain(".fred-reasoning-context-menu");
    expect(cssSource).toContain(".fred-reasoning-context-menu button.is-primary");
    expect(cssSource).toContain(".fred-reasoning-dialog");
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

  it("replaces the answered turn during regeneration instead of appending a duplicate", () => {
    expect(viewSource).toContain("messagesBeforeRegeneratedAnswer(messages, assistantIndex)");
    expect(viewSource).toContain("messagesBeforeQuery,");
    expect(viewSource).toContain("rollbackMessages: messages,");
    expect(viewSource).toContain("...(options.messagesBeforeQuery ?? messages), userMessage");
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
    expect(attachmentValidationSource).toContain("MAX_IMAGE_UPLOADS = 5");
    expect(attachmentValidationSource).toContain("MAX_FILE_UPLOADS = 5");
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

  it("renders compact icon-only Pro and Websuche buttons in the requested order", () => {
    const proIndex = viewSource.indexOf("fred-pro-toggle");
    const webSearchIndex = viewSource.indexOf("fred-web-search-toggle");
    expect(proIndex).toBeGreaterThan(0);
    expect(proIndex).toBeLessThan(webSearchIndex);

    const proButton = viewSource.slice(proIndex, viewSource.indexOf("</button>", proIndex));
    const webSearchButton = viewSource.slice(webSearchIndex, viewSource.indexOf("</button>", webSearchIndex));
    expect(proButton).toContain('className="fred-pro-icon"');
    expect(webSearchButton).toContain('className="fred-web-search-icon"');
    expect(proButton).toContain('fill="none" stroke="currentColor"');
    expect(webSearchButton).toContain('fill="none" stroke="currentColor"');
    expect(proButton).not.toContain("<span>");
    expect(webSearchButton).not.toContain("<span>");
    expect(cssSource).toContain(".composer-model-trigger.composer-icon-toggle");
  });

  it("uses the requested tooltip and dynamic aria-label on the Pro button", () => {
    expect(viewSource).toContain('aria-pressed={proModeEnabled}');
    expect(viewSource).toContain('title="Thinking"');
    expect(viewSource).toContain('aria-label={proModeEnabled ? "Pro-Modus aktiv" : "Pro-Modus verwenden"}');
  });

  it("uses the requested tooltip and dynamic aria-label on the icon-only Websuche button", () => {
    expect(viewSource).toContain('title="Websuche"');
    expect(viewSource).toContain('aria-label={webSearchEnabled ? "Websuche aktiv" : "Websuche verwenden"}');
  });

  it("shows auto-hiding mobile status popups for Thinking and Websuche toggles", () => {
    expect(viewSource).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(viewSource).toContain('"Thinking aktiviert"');
    expect(viewSource).toContain('"Thinking deaktiviert"');
    expect(viewSource).toContain('"Websuche aktiviert"');
    expect(viewSource).toContain('"Websuche deaktiviert"');
    expect(viewSource).toContain('window.setTimeout(() => setModeNotice(""), 1_800)');
    expect(cssSource).toContain(".fred-mode-notice");
    expect(cssSource).toContain("@keyframes fredModeNoticeIn");
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

describe("QuickFred removal — composer control absent, attribution preserved", () => {
  it("does not render the QuickFred lightning toggle in the composer", () => {
    expect(viewSource).not.toContain("fred-quick-toggle");
    expect(viewSource).not.toContain("fred-quick-icon");
    expect(viewSource).not.toContain('title="Fastmode');
    expect(viewSource).not.toContain('"Fastmode aktiviert"');
    expect(viewSource).not.toContain('"Fastmode deaktiviert"');
  });

  it("keeps QuickFred conversation attribution and scoped badge rendering", () => {
    expect(viewSource).toContain("fredAgentName(message.agentKey)");
    expect(viewSource).toContain(">QuickFred</span>");
    expect(viewSource).toContain('disabled={isSending || conversationAgentKey === "quickfred"}');
  });

  it("does not leak WeKnora QuickFred server configuration to the client", () => {
    expect(viewSource).not.toContain("WEKNORA_QUICKFRED_AGENT_ID");
    expect(viewSource).not.toContain("WEKNORA_QUICKFRED_PUBLISH_TOKEN");
  });

  it("preserves the QuickFred agent key in the FredAgentKey union", () => {
    expect(viewSource).toContain('agentName: "Fred" | "QuickFred"');
  });
});

describe("Fred public answer sharing", () => {
  it("renders a share button only for completed assistant messages with a positive persisted id", () => {
    expect(viewSource).toContain('aria-label="Antwort öffentlich teilen"');
    expect(viewSource).toContain("handleShareAnswer(message.id!)");
    // Only for messages that have a truthy message.id — disabled only for in-flight target or missing id
    expect(viewSource).toMatch(/disabled=\{shareInFlightIds\.has\(message\.id!\) \|\| !message\.id\}/);
  });

  it("keeps loading state per message ID and disables only that button", () => {
    expect(viewSource).toContain('const [shareInFlightIds, setShareInFlightIds] = useState<Set<number>>(() => new Set())');
    expect(viewSource).toContain("shareInFlightIds.has(message.id!)");
    expect(viewSource).toContain("aria-busy={shareInFlightIds.has(message.id!)}");
    expect(viewSource).toContain("Wird geteilt …");
  });

  it("renders a visible compact live status for copy and error states", () => {
    expect(viewSource).toContain('className="fred-share-status"');
    expect(viewSource).toContain('role="status"');
    expect(viewSource).toContain('aria-live="polite"');
    expect(viewSource).toContain("Öffentlicher Link kopiert");
    expect(viewSource).toContain("Teilen fehlgeschlagen");
    expect(cssSource).toContain(".fred-share-status");
  });

  it("POSTs only conversationId and assistantMessageId with bearer token", () => {
    expect(viewSource).toContain('"/api/fred/public-shares"');
    expect(viewSource).toContain("conversationId: conversationIdValue");
    expect(viewSource).toContain("assistantMessageId: messageId");
    expect(viewSource).toContain("Authorization: `Bearer ${accessToken}`");
  });

  it("uses native Web Share when available", () => {
    expect(viewSource).toContain("navigator.share");
    expect(viewSource).toContain('title: "Geteilte Fred-Antwort"');
    expect(viewSource).toContain("new URL(payload.sharePath as string, window.location.origin)");
  });

  it("falls back to clipboard when Web Share is unavailable", () => {
    expect(viewSource).toContain("await copyToClipboard(url.toString())");
    expect(viewSource).toContain("Öffentlicher Link kopiert");
  });

  it("treats Web Share AbortError as cancellation not failure", () => {
    expect(viewSource).toContain("AbortError");
    expect(viewSource).toMatch(/err\.name === "AbortError"/);
    // The return statement after AbortError means no copy/error state is set
  });

  it("shows compact error and resets share state after timeout", () => {
    expect(viewSource).toContain('setShareCopiedKey(`error-${messageId}`)');
    expect(viewSource).toContain("shareStatusTimeoutRef.current");
    expect(viewSource).toContain("setShareCopiedKey(");
    // Clears timeout before setting new one
    expect(viewSource).toContain("clearTimeout(shareStatusTimeoutRef.current)");
  });

  it("clears share state and timeout on conversation switch", () => {
    expect(viewSource).toContain("setShareInFlightIds(new Set());");
    expect(viewSource).toContain('setShareCopiedKey("");');
    expect(viewSource).toMatch(
      /if \(conversationId === activeConversationIdRef\.current\) return;[\s\S]*?clearTimeout\(shareStatusTimeoutRef\.current\);[\s\S]*?shareStatusTimeoutRef\.current = null;/u,
    );
  });

  it("matches per-message share status keys exactly", () => {
    expect(viewSource).toContain('shareCopiedKey === `copied-${message.id}`');
    expect(viewSource).toContain('shareCopiedKey === `error-${message.id}`');
    expect(viewSource).not.toContain('shareCopiedKey.startsWith(`copied-${message.id}`)');
    expect(viewSource).not.toContain('shareCopiedKey.startsWith(`error-${message.id}`)');
  });

  it("cleans share status timeout on unmount", () => {
    expect(viewSource).toContain("if (shareStatusTimeoutRef.current) clearTimeout(shareStatusTimeoutRef.current)");
  });

  it("uses a sync ref-backed in-flight set to guard against same-tick duplicate share clicks", () => {
    expect(viewSource).toContain("const shareInFlightRef = useRef<Set<number>>(new Set())");
    expect(viewSource).toContain("shareInFlightRef.current.has(messageId)");
    expect(viewSource).toContain("shareInFlightRef.current.add(messageId)");
    expect(viewSource).toContain("shareInFlightRef.current.delete(messageId)");
  });

  it("tracks AbortControllers per message ID and passes signal to fetch", () => {
    expect(viewSource).toContain("const shareAbortControllersRef = useRef<Map<number, AbortController>>(new Map())");
    expect(viewSource).toContain("const controller = new AbortController()");
    expect(viewSource).toContain("shareAbortControllersRef.current.set(messageId, controller)");
    expect(viewSource).toContain("signal: controller.signal");
  });

  it("aborts all active share requests and clears refs on conversation switch", () => {
    expect(viewSource).toContain("for (const ctrl of shareAbortControllersRef.current.values()) ctrl.abort()");
    expect(viewSource).toContain("shareAbortControllersRef.current.clear()");
    expect(viewSource).toContain("shareInFlightRef.current.clear()");
  });

  it("aborts all active share requests and clears refs on unmount", () => {
    // In the unmount useEffect cleanup
    const unmountEffect = /useEffect\(\(\) => \(\) => \{[\s\S]*?shareAbortControllersRef\.current\.values\(\)\) ctrl\.abort\(\)[\s\S]*?\}, \[\]\)/;
    expect(unmountEffect.test(viewSource)).toBe(true);
  });

  it("only clears state for the request that still owns the controller in finally", () => {
    expect(viewSource).toMatch(
      /if \(shareAbortControllersRef\.current\.get\(messageId\) === controller\) \{[\s\S]*?shareAbortControllersRef\.current\.delete\(messageId\);[\s\S]*?shareInFlightRef\.current\.delete\(messageId\);/u,
    );
  });

  it("blocks stale requests from clipboard and status side effects", () => {
    expect(viewSource).toContain("const isCurrentRequest = () => (");
    expect(viewSource).toContain("if (!isCurrentRequest()) return;");
    expect(viewSource).toContain("if (isCurrentRequest()) setShareCopiedKey(`copied-${messageId}`)");
    expect(viewSource).toContain("controller.signal.aborted ||");
  });

  it("treats fetch AbortError as silent cancellation without setting error status", () => {
    expect(viewSource).toContain('err instanceof DOMException && err.name === "AbortError"');
    expect(viewSource).toMatch(
      /catch\s*\(err:\s*unknown\)\s*\{[\s\S]*?if\s*\(controller\.signal\.aborted\s*\|\|\s*\(err\s+instanceof\s+DOMException\s+&&\s+err\.name\s*===\s*"AbortError"\)\)\s*return/u,
    );
  });
});

describe("Fred ResearchTrace rendering", () => {
  it("renders ResearchTrace only for active assistant, never for committed/history messages", () => {
    // ResearchTrace with `active` prop should only appear in the activeAssistant block
    const activeTrace = /<ResearchTrace\s+steps=\{activeAssistant\.researchTrace[\s\S]*?active\s+agentName=\{fredAgentName\(activeAssistant\.agentKey\)\}[\s\S]*?\/>([\s\S]*?)<StreamingAssistantPreview/u;
    expect(activeTrace.test(viewSource)).toBe(true);
    // Committed messages must not render ResearchTrace.
    // Verify renderAssistantContent(message.content) is present for committed messages
    expect(viewSource).toContain("renderAssistantContent(message.content)");
    // Exactly one JSX <ResearchTrace usage — only in the active assistant pending block
    const researchTraceUsages = (viewSource.match(/<ResearchTrace/g) || []).length;
    expect(researchTraceUsages).toBe(1);
  });
});