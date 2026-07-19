import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(
  fileURLToPath(new URL("../components/fred-embed-view.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const nextConfigSource = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");

describe("Fred secure embed UI", () => {
  it("registers Fred in both authenticated navigation modes and renders its own view", () => {
    expect(pageSource).toContain('type AppView = "chat" | "fred"');
    expect(pageSource.match(/onClick=\{openFredView\}/gu)).toHaveLength(2);
    expect(pageSource).toContain('className={`sidebar-view-button ${appView === "fred" ? "active" : ""}`}');
    expect(pageSource).toContain('title="Fred"');
    expect(pageSource).toContain('aria-label="Fred"');
    expect(pageSource).toContain('<FredEmbedView accessToken={session?.access_token ?? ""} />');
  });

  it("fetches only a short-lived session token through the authenticated Findog route", () => {
    expect(viewSource).toContain('const EMBED_TOKEN_ENDPOINT = "/api/fred/embed-token"');
    expect(viewSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(viewSource).toContain('cache: "no-store"');
    expect(viewSource).toContain('credentials: "same-origin"');
    expect(viewSource).toContain('const SESSION_TOKEN_PATTERN = /^ems_');
    expect(viewSource).toContain('value.embedOrigin !== EMBED_ORIGIN');
    expect(viewSource).not.toContain("X-API-Key");
    expect(viewSource).not.toContain("WEKNORA_PUBLISH_TOKEN");
    expect(viewSource).not.toContain("weknora-widget.js");
    expect(viewSource).not.toContain("next/script");
  });

  it("hands the token only to the exact iframe window, origin, source, and channel", () => {
    expect(viewSource).toContain('const EMBED_ORIGIN = "https://taxdog.cloud"');
    expect(viewSource).toContain('event.source !== frameWindow');
    expect(viewSource).toContain('event.origin !== activeConfig.embedOrigin');
    expect(viewSource).toContain('event.data.source !== EMBED_SOURCE');
    expect(viewSource).toContain('event.data.channel_id !== activeConfig.channelId');
    expect(viewSource).toContain('type: "provide_token"');
    expect(viewSource).toContain('channel_id: currentConfig.channelId');
    expect(viewSource).toMatch(/frameWindow\.postMessage\([\s\S]*?currentConfig\.embedOrigin,\s*\);/u);
    expect(viewSource).not.toMatch(/\.postMessage\([\s\S]*?["']\*["']/u);
  });

  it("refreshes before expiry, retries while the current token remains valid, and supports manual recovery", () => {
    expect(viewSource).toContain('const INITIAL_RETRY_DELAYS_MS = [1_000, 3_000] as const');
    expect(viewSource).toContain('const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const');
    expect(viewSource).toContain('Math.floor(expiresIn * 0.8)');
    expect(viewSource).toContain('const remainingMs = expiresAt - Date.now()');
    expect(viewSource).toContain('Math.min(baseDelay, remainingMs - REFRESH_EXPIRY_MARGIN_MS)');
    expect(viewSource).toContain('void requestToken("refresh", 0)');
    expect(viewSource).toContain('onRetry={() => setLoadGeneration((current) => current + 1)}');
    expect(viewSource).toContain("Erneut versuchen");
  });

  it("provides the token both proactively after iframe load and on the authenticated bootstrap request", () => {
    expect(viewSource).toMatch(/onLoad=\{\(\) => \{[\s\S]*?provideToken\(\);[\s\S]*?\}\}/u);
    expect(viewSource).toMatch(/event\.data\.type === "bootstrap_request"[\s\S]*?provideToken\(\)/u);
  });

  it("isolates Taxdog storage and resets the top-level context when the Findog account changes", () => {
    expect(viewSource).toContain('const CREDENTIALLESS_IFRAME_ATTRIBUTE = { credentialless: "" } as const');
    expect(viewSource).toContain('{...CREDENTIALLESS_IFRAME_ATTRIBUTE}');
    expect(viewSource).toContain('"credentialless" in HTMLIFrameElement.prototype');
    expect(pageSource).toContain('const secureEmbedOwnerIdRef = useRef<string | null>(null)');
    expect(pageSource).toContain('previousUserId && previousUserId !== nextUserId');
    expect(pageSource).toContain('window.location.reload()');
  });

  it("remounts WeKnora with a renewed token and fails a stalled bootstrap", () => {
    expect(viewSource).toContain('setIframeGeneration((current) => current + 1)');
    expect(viewSource).toContain('key={iframeGeneration}');
    expect(viewSource).toContain('iframeGeneration > 0 ? `?r=${iframeGeneration}` : ""');
    expect(viewSource).toContain('const EMBED_READY_TIMEOUT_MS = 20_000');
    expect(viewSource).toContain('Fred hat den sicheren Verbindungsaufbau nicht abgeschlossen.');
  });

  it("renders a full-page sandboxed iframe with loading and failure states", () => {
    expect(viewSource).toContain('`${config.embedOrigin}/embed/${encodeURIComponent(config.channelId)}${');
    expect(viewSource).toContain('sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"');
    expect(viewSource).toContain('referrerPolicy="no-referrer"');
    expect(viewSource).toContain('allow="clipboard-write"');
    expect(viewSource).toContain('title="Fred"');
    expect(viewSource).toContain('aria-busy={phase === "loading"}');
    expect(viewSource).toContain('role="alert"');
    expect(cssSource).toMatch(/\.fred-embed-panel \{[\s\S]*?min-height: 0;[\s\S]*?height: 100%;/u);
    expect(cssSource).toMatch(/\.fred-embed-frame \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/u);
    expect(cssSource).toMatch(/@media \(max-width: 960px\) \{[\s\S]*?\.fred-embed-panel/u);
  });

  it("brands the Findog host page with the Fred image without weakening iframe isolation", () => {
    expect(viewSource).toContain('src="/fred.png"');
    expect(viewSource).toContain('alt="Fred, der Findog-Assistent"');
    expect(viewSource).toContain('className="fred-embed-hero"');
    expect(viewSource).toContain('import { getWelcomeGreeting } from "@/lib/chat/welcome"');
    expect(viewSource).toContain('const [welcomeGreeting] = useState(() => getWelcomeGreeting())');
    expect(viewSource).toContain('<h1 className="fred-embed-greeting">{welcomeGreeting}</h1>');
    expect(viewSource.indexOf('src="/fred.png"')).toBeLessThan(
      viewSource.indexOf('className="fred-embed-greeting"'),
    );
    expect(viewSource).not.toContain("Frag Fred");
    expect(cssSource).toMatch(/\.fred-embed-hero \{[\s\S]*?align-items: center;/u);
    expect(cssSource).toMatch(/\.fred-embed-hero-image \{[\s\S]*?object-fit: contain;/u);
  });

  it("allows only the taxdog iframe while preserving Findog anti-framing headers", () => {
    expect(nextConfigSource).toContain("frame-src 'self' https://taxdog.cloud");
    expect(nextConfigSource).toContain("frame-ancestors 'none'");
    expect(nextConfigSource).toContain('{ key: "X-Frame-Options", value: "DENY" }');
    expect(nextConfigSource).not.toContain("script-src 'self' 'unsafe-inline' https://taxdog.cloud");
    expect(nextConfigSource).not.toContain("connect-src 'self' https://taxdog.cloud");
  });
});
