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
const capabilitiesRouteSource = readFileSync(
  fileURLToPath(new URL("../app/api/fred/capabilities/route.ts", import.meta.url)),
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

  it("renders the optimized sniff animation with a reduced-motion still", () => {
    expect(viewSource).toContain('src="/fred-sniff.webp"');
    expect(viewSource).toContain('srcSet="/fred-sniff-static.webp"');
    expect(viewSource).toContain('media="(prefers-reduced-motion: reduce)"');
    expect(viewSource).toContain('width={224} height={166}');
    expect(cssSource).toMatch(
      /\.fred-sniff-animation \{[\s\S]*?width: 112px;[\s\S]*?height: auto;/u,
    );
  });

  it("uses a neutral document status and clears it without replacing it with agent copy", () => {
    expect(routeSource).toContain('label: "Dokumente werden analysiert …"');
    expect(routeSource).not.toContain("Anhänge werden an WeKnora übergeben …");
    expect(routeSource).not.toContain("Anhänge werden analysiert …");
    expect(routeSource).not.toContain("bearbeitet die Frage …");
    expect(routeSource).toContain('type: "status_clear"');
    expect(routeSource).toContain("if (!attachmentStatusPending) return;");
    expect(viewSource).toContain("if (!showingStatusRef.current) return;");
    expect(viewSource).toContain('previewContainerRef.current?.classList.add("is-status")');
    expect(viewSource).toContain("clearStatus");
    expect(viewSource).toContain('streamEvent.type === "status_clear"');
    expect(viewSource).toContain('previewContainerRef.current?.classList.remove("is-status")');
    expect(viewSource).toContain('className="fred-streaming-preview" ref={previewContainerRef}');
    expect(cssSource).toMatch(
      /\.fred-streaming-preview:not\(\.is-status\)[\s\S]*?\.fred-streaming-preview-text:not\(:empty\)[\s\S]*?\+ \.fred-thinking-indicator \{[\s\S]*?display: none;/u,
    );
  });

  it("uses Findog message bubbles, rich answers and the native composer for live responses", () => {
    expect(viewSource).toContain('className={`message ${message.role}');
    expect(viewSource).toContain("renderAssistantContent(message.content)");
    expect(viewSource).toContain("function FredSniffingIndicator");
    expect(viewSource.match(/<FredSniffingIndicator/g)).toHaveLength(2);
    expect(viewSource).toContain('role="status"');
    expect(viewSource).toContain('aria-label={`${agentName} denkt nach`}');
    expect(viewSource).toContain('<picture className="fred-sniff-animation">');
    expect(viewSource).toContain('src="/fred-sniff.webp"');
    expect(viewSource).not.toContain('src="/fred-sniff.gif"');
    expect(viewSource).toContain('className="fred-thinking-indicator"');
    expect(viewSource).not.toContain('<p className="message-body">Fred denkt nach');
    expect(viewSource).toContain('className="composer"');
    expect(viewSource).toContain('className="composer-icon-button"');
    expect(viewSource).toContain("autosizeComposer(textarea)");
    expect(viewSource).toContain("resetComposerHeight(composerRef.current)");
    expect(viewSource).toContain("ref={composerRef}");
    expect(viewSource).toContain("Bild anhängen");
    expect(viewSource).toContain("Datei anhängen");
    expect(viewSource).toContain("imageUpload: boolean");
    expect(viewSource).toContain("capabilities.fileUpload || capabilities.imageUpload");
    expect(viewSource).toContain("{capabilities.imageUpload ? (");
    expect(viewSource).toContain("{capabilities.fileUpload ? (");
    expect(viewSource).toContain("if (!capabilities.imageUpload)");
    expect(viewSource).toContain("Bild-Uploads sind derzeit nicht verfügbar.");
    expect(viewSource).toContain("max. {MAX_IMAGE_UPLOADS} · je 10 MB");
    expect(viewSource).toContain("max. {MAX_FILE_UPLOADS} · je 20 MB");
    expect(viewSource).toContain('className="fred-quick-icon"');
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

describe("Fred composer routing UI", () => {
  it("includes server capabilities for QuickFred and historical Pro support", () => {
    expect(capabilitiesRouteSource).toContain("quickFred: capabilities.quickFred");
    expect(viewSource).toContain("quickFred: boolean");
    expect(viewSource).toContain("quickFred: value.quickFred === true");
    expect(viewSource).toContain("proMode: boolean");
    expect(viewSource).toContain("proMode: value.proMode === true");
  });

  it("renders compact icon-only Quickmode and Websuche buttons in the requested order", () => {
    const quickIndex = viewSource.indexOf("fred-quick-toggle");
    const webSearchIndex = viewSource.indexOf("fred-web-search-toggle");
    expect(quickIndex).toBeGreaterThan(0);
    expect(quickIndex).toBeLessThan(webSearchIndex);

    const quickButton = viewSource.slice(quickIndex, viewSource.indexOf("</button>", quickIndex));
    const webSearchButton = viewSource.slice(webSearchIndex, viewSource.indexOf("</button>", webSearchIndex));
    expect(quickButton).toContain('className="fred-quick-icon"');
    expect(webSearchButton).toContain('className="fred-web-search-icon"');
    expect(quickButton).not.toContain("<span>");
    expect(webSearchButton).not.toContain("<span>");
    expect(cssSource).toMatch(
      /\.composer-model-trigger\.composer-icon-toggle\.fred-quick-toggle \{[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?min-width: 34px;/u,
    );
    expect(cssSource).toContain(
      ".composer-model-trigger.composer-icon-toggle.fred-quick-toggle.is-active",
    );
  });

  it("uses the requested Quickmode tooltip and dynamic accessible name", () => {
    expect(viewSource).toContain('aria-pressed={quickFredEnabled}');
    expect(viewSource).toContain('title="Quickmode für schnelle Antworten"');
    expect(viewSource).toContain('aria-label={quickFredEnabled ? "Quickmode aktiv" : "Quickmode verwenden"}');
  });

  it("shows auto-hiding mobile status popups for Quickmode and Websuche toggles", () => {
    expect(viewSource).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(viewSource).toContain('"Quickmode aktiviert"');
    expect(viewSource).toContain('"Quickmode deaktiviert"');
    expect(viewSource).toContain('"Websuche aktiviert"');
    expect(viewSource).toContain('"Websuche deaktiviert"');
    expect(viewSource).toContain('window.setTimeout(() => setModeNotice(""), 1_800)');
    expect(cssSource).toContain(".fred-mode-notice");
    expect(cssSource).toContain("@keyframes fredModeNoticeIn");
  });

  it("removes the Pro/Thinking composer control and its control-specific styling", () => {
    expect(viewSource).not.toContain("fred-pro-toggle");
    expect(viewSource).not.toContain("fred-pro-icon");
    expect(viewSource).not.toContain('title="Thinking"');
    expect(viewSource).not.toContain('"Pro-Modus aktiv"');
    expect(viewSource).not.toContain('"Pro-Modus verwenden"');
    expect(viewSource).not.toContain('"Thinking aktiviert"');
    expect(viewSource).not.toContain('"Thinking deaktiviert"');
    expect(cssSource).not.toContain(".fred-pro-toggle");
    expect(cssSource).not.toContain(".fred-pro-icon");
  });

  it("sends only a boolean QuickFred selection and no routing configuration", () => {
    expect(viewSource).toContain('quickFredEnabled: agentKey === "quickfred"');
    expect(viewSource).not.toMatch(/quickFredEnabled:\s*[^,}]+[^=][^,}]*Id/u);
    expect(viewSource).not.toContain("WEKNORA_QUICKFRED_AGENT_ID");
    expect(viewSource).not.toContain("WEKNORA_QUICKFRED_PUBLISH_TOKEN");
    expect(viewSource).not.toMatch(/WEKNORA_QUICKFRED_(?:CHANNEL|AGENT|PUBLISH_TOKEN)_?/u);
    expect(viewSource).not.toContain("quickfred-channel");
    expect(viewSource).not.toContain("expectedAgentId");
    expect(viewSource).not.toContain("publishToken");
  });

  it("locks the conversation agent after the first turn", () => {
    expect(viewSource).toMatch(/const agentKey: FredAgentKey = conversationAgentKey\n\s*\?\? \(options\.quickFredEnabled === true \? "quickfred" : "fred"\);/u);
    expect(viewSource).toContain('disabled={isSending || conversationAgentKey !== null || !capabilities.quickFred}');
    expect(viewSource).toContain('setConversationAgentKey(streamEvent.conversation.agentKey)');
    expect(viewSource).toContain('setQuickFredEnabled(streamEvent.conversation.agentKey === "quickfred")');
  });

  it("keeps web search independent of Quickmode", () => {
    expect(viewSource).toContain("webSearchEnabled");
    expect(viewSource).not.toContain("setWebSearchEnabled(false);\n                      setQuickFredEnabled");
  });

  it("keeps historical Pro metadata, edit defaults, regeneration and badges outside the composer", () => {
    expect(viewSource).toContain("proModeEnabled?: boolean");
    expect(viewSource).toContain("userMessage.proModeEnabled = isProMode;");
    expect(viewSource).toContain("proModeEnabled: isProMode,");
    expect(viewSource).toContain("const originalProMode = Boolean(question.proModeEnabled && capabilities.proMode);");
    expect(viewSource).toContain("proModeEnabled: originalProMode,");
    expect(viewSource).toContain("message.proModeEnabled ? (");
    expect(viewSource).toContain('>Pro</span>');
    const editBlock = /function editQuestion\([\s\S]*?function handleShareAnswer/u.exec(viewSource)?.[0] ?? "";
    expect(editBlock).not.toContain("message.proModeEnabled");
    const sendBlock = /async function sendMessage\([\s\S]*?function editQuestion/u.exec(viewSource)?.[0] ?? "";
    expect(sendBlock).toContain('proModeEnabled: false');
  });

  it("keeps QuickFred conversation attribution and scoped badge rendering", () => {
    expect(viewSource).toContain("fredAgentName(message.agentKey)");
    expect(viewSource).toContain(">QuickFred</span>");
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
  it("renders the research trace below active streaming and completed answers", () => {
    const committedAnswerIndex = viewSource.indexOf("renderAssistantContent(message.content)");
    const committedTraceIndex = viewSource.indexOf("<ResearchTrace", committedAnswerIndex);
    const feedbackIndex = viewSource.indexOf('className="fred-feedback"', committedAnswerIndex);
    expect(committedAnswerIndex).toBeGreaterThan(0);
    expect(committedTraceIndex).toBeGreaterThan(committedAnswerIndex);
    expect(committedTraceIndex).toBeLessThan(feedbackIndex);

    const activeAssistantIndex = viewSource.indexOf("{activeAssistant ? (");
    const streamingPreviewIndex = viewSource.indexOf("<StreamingAssistantPreview", activeAssistantIndex);
    const activeTraceIndex = viewSource.indexOf("<ResearchTrace", activeAssistantIndex);
    expect(streamingPreviewIndex).toBeGreaterThan(activeAssistantIndex);
    expect(activeTraceIndex).toBeGreaterThan(streamingPreviewIndex);
    expect((viewSource.match(/<ResearchTrace/g) || []).length).toBe(2);
  });

  it("keeps the active trace open and collapses the completed trace", () => {
    expect(viewSource).toContain("<details className=\"fred-research-trace\" open={active}>");
    expect(viewSource).toMatch(/steps=\{message\.researchTrace \?\? \[\]\}[\s\S]*?active=\{false\}/u);
    expect(viewSource).toMatch(/steps=\{activeAssistant\.researchTrace \?\? \[\]\}[\s\S]*?\n\s+active\n/u);
  });

  it("passes researchDisplayMode from page state to FredPersonalizationSettings and FredNativeChatView", () => {
    expect(pageSource).toContain("const [researchDisplayMode, setResearchDisplayMode] = useState<\"simple\" | \"advanced\">(\"simple\");");
    expect(pageSource).toContain("onResearchDisplayModeChange={setResearchDisplayMode}");
    expect(pageSource).toContain("researchDisplayMode={researchDisplayMode}");
    expect(pageSource).toContain('fetch("/api/account/settings/fred-personalization"');
    expect(pageSource).toContain('setResearchDisplayMode(payload.researchDisplayMode === "advanced" ? "advanced" : "simple")');
    expect(viewSource).toContain("researchDisplayMode?: \"simple\" | \"advanced\";");
    expect(viewSource).toMatch(/displayMode=\{researchDisplayMode\}/u);
  });

  it("renders advanced execution steps when displayMode is advanced and executionSteps exist", () => {
    expect(viewSource).toContain("className=\"fred-execution-steps\"");
    expect(viewSource).toContain("className=\"fred-execution-status\"");
    expect(viewSource).toContain("className=\"fred-execution-body\"");
    expect(viewSource).toContain("className=\"fred-execution-header\"");
    expect(viewSource).toContain("className=\"fred-execution-label\"");
    expect(viewSource).toContain("className=\"fred-execution-duration\"");
    expect(viewSource).toContain("className=\"fred-execution-detail\"");
  });

  it("defines consistent CSS styles for execution steps in globals.css", () => {
    expect(cssSource).toContain(".fred-execution-steps");
    expect(cssSource).toContain(".fred-execution-status");
    expect(cssSource).toContain(".fred-execution-body");
    expect(cssSource).toContain(".fred-execution-header");
    expect(cssSource).toContain(".fred-execution-label");
    expect(cssSource).toContain(".fred-execution-duration");
    expect(cssSource).toContain(".fred-execution-detail");
  });
});
