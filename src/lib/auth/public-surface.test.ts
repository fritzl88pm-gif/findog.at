import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("public auth surface", () => {
  const pagePath = fileURLToPath(new URL("../../app/page.tsx", import.meta.url));
  const source = readFileSync(pagePath, "utf8");

  function unauthenticatedLoginSource(): string {
    const start = source.indexOf("  if (!user) {");
    const appShellReturn = /\r?\n  return \(\r?\n    <main className="app-shell">/u.exec(
      source.slice(start),
    );
    const end = appShellReturn ? start + appShellReturn.index : -1;

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return source.slice(start, end);
  }

  it("offers password sign-in without registration", () => {
    expect(source).toContain("signInWithPassword");
    expect(source).not.toMatch(/\bsignUp\b|sign-up|Registrier/);
  });

  it("contains no Magic Link or password-recovery code or UI", () => {
    for (const forbidden of [
      "signInWithOtp",
      "resetPasswordForEmail",
      "Magic Link",
      "Passwort vergessen",
      "PASSWORD_RECOVERY",
      "isRecoveryMode",
      "recoveryForm",
      "handleRecovery",
    ]) {
      expect(source, `page.tsx still contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shows the Fred login illustration directly above the existing auth copy", () => {
    const login = unauthenticatedLoginSource();

    expect(login).toMatch(
      /<img\s+className="fred-login-image"\s+src="\/fred-login\.png"\s+alt="[^"]+"\s*\/>\s*<p className="auth-copy">/,
    );
    expect(login).toContain("Melde dich mit E-Mail und Passwort an.");
  });

  it("removes only the normal login card eyebrow and heading", () => {
    const login = unauthenticatedLoginSource();

    expect(login).not.toContain('<p className="eyebrow">findog.at</p>');
    expect(login).not.toContain("<h1>Anmelden</h1>");
    expect(source).toContain('<section className="auth-card auth-card-standalone" aria-label="Anmeldung wird geprüft">');
    expect(source).toContain('<p className="eyebrow">findog.at</p>');
    expect(source).toContain("<h1>Anmeldung prüfen</h1>");
  });
});
