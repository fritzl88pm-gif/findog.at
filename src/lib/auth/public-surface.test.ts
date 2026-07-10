import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("public auth surface", () => {
  const pagePath = fileURLToPath(new URL("../../app/page.tsx", import.meta.url));
  const source = readFileSync(pagePath, "utf8");

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
});
