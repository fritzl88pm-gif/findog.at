import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(
  fileURLToPath(new URL("../components/fred-native-chat-view.tsx", import.meta.url)),
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
});
