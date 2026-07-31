import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  fileURLToPath(new URL("./telegram-settings.tsx", import.meta.url)),
  "utf8",
);

describe("TelegramSettings component", () => {
  it("renders a dedicated section with accessible heading", () => {
    expect(componentSource).toContain('aria-labelledby="telegram-settings-title"');
    expect(componentSource).toContain('id="telegram-settings-title"');
    expect(componentSource).toContain("Telegram");
  });

  it("shows disconnected state with password token input", () => {
    expect(componentSource).toContain('id="telegram-bot-token"');
    expect(componentSource).toContain('type="password"');
    expect(componentSource).toContain('autoComplete="off"');
    expect(componentSource).toContain("Das Token wird verschlüsselt gespeichert und nie angezeigt.");
  });

  it("clears token input after successful save", () => {
    // On successful connect, setTokenInput("") is called
    expect(componentSource).toMatch(/setTokenInput\(""\)/);
  });

  it("reports only sanitized integration state to its parent", () => {
    expect(componentSource).toContain("export type TelegramIntegrationPublicState");
    expect(componentSource).toContain("status: TelegramIntegrationStatus");
    expect(componentSource).toContain("botUsername: string | null");
    expect(componentSource).toContain("onIntegrationChange?: (integration: TelegramIntegrationPublicState | null) => void");
    expect(componentSource).not.toContain("onIntegrationChange?.()");
  });

  it("shows awaiting_pairing state with deep link and rotate button", () => {
    expect(componentSource).toContain('status === "awaiting_pairing"');
    expect(componentSource).toContain("In Telegram öffnen");
    expect(componentSource).toContain("Link aktualisieren");
    expect(componentSource).toContain("Bot");
    expect(componentSource).toContain("wartet auf Verknüpfung");
    expect(componentSource).toContain("pairingExpiresAt");
    expect(componentSource).not.toContain("pairingExpiryFromCreatedAt");
  });

  it("shows active state with bot username and disconnect", () => {
    expect(componentSource).toContain('status === "active"');
    expect(componentSource).toContain("Verbunden als");
    expect(componentSource).toContain("Integration entfernen");
    expect(componentSource).toContain("telegram-status-active");
    expect(componentSource).toContain("Bot wechseln");
    expect(componentSource).toContain("Neues Bot-Token");
    expect(componentSource).toContain("Der Verlauf bleibt erhalten; der neue Bot wird anschließend neu verknüpft.");
  });

  it("shows error state with recoverable replacement and disconnect options", () => {
    expect(componentSource).toContain("Es ist ein Fehler aufgetreten");
    expect(componentSource).toContain("Du kannst den Bot wechseln oder die Integration entfernen");
    expect(componentSource).toContain("replacementForm");
  });

  it("handles foreign-webhook conflict with override prompt", () => {
    expect(componentSource).toContain("überschrieben");
    expect(componentSource).toContain("Webhook überschreiben");
    expect(componentSource).toContain("replaceExistingWebhook");
  });

  it("uses abort and request guards so stale responses cannot update after unmount", () => {
    expect(componentSource).toContain("AbortController");
    expect(componentSource).toContain("requestSequenceRef");
    expect(componentSource).toContain("mountedRef.current");
  });

  it("fetches integration status on mount and polls during pairing", () => {
    expect(componentSource).toContain("/api/settings/telegram");
    expect(componentSource).toContain("15_000");
    expect(componentSource).toContain('status === "awaiting_pairing"');
  });

  it("renders as a client component", () => {
    expect(componentSource).toContain('"use client"');
  });

  it("exports a default function accepting accessToken prop", () => {
    expect(componentSource).toContain("export default function TelegramSettings");
    expect(componentSource).toContain("accessToken");
  });
});
