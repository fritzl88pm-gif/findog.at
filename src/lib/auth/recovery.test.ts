import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isValidEmailAddress,
  isPasswordRecoveryEvent,
  nextRecoveryMode,
  validateNewPassword,
} from "@/lib/auth/recovery";

describe("password recovery state", () => {
  it("detects the Supabase password-recovery event", () => {
    expect(isPasswordRecoveryEvent("PASSWORD_RECOVERY")).toBe(true);
    expect(isPasswordRecoveryEvent("SIGNED_IN")).toBe(false);
  });

  it("enters recovery mode only after a password-recovery event", () => {
    expect(nextRecoveryMode(false, "PASSWORD_RECOVERY")).toBe(true);
  });

  it("does not enter recovery mode for an ordinary signed-in session", () => {
    expect(nextRecoveryMode(false, "SIGNED_IN")).toBe(false);
    expect(nextRecoveryMode(false, "INITIAL_SESSION")).toBe(false);
  });

  it("leaves recovery mode when the session is signed out", () => {
    expect(nextRecoveryMode(true, "SIGNED_OUT")).toBe(false);
  });
});

describe("new-password validation", () => {
  it("requires both password fields", () => {
    expect(validateNewPassword("", "")).toBe(
      "Bitte neues Passwort und Bestätigung eingeben.",
    );
  });

  it("rejects a password shorter than six characters", () => {
    expect(validateNewPassword("kurz", "kurz")).toBe(
      "Das Passwort muss mindestens 6 Zeichen lang sein.",
    );
  });

  it("rejects passwords that do not match", () => {
    expect(validateNewPassword("abcdef", "abcdefg")).toBe(
      "Die Passwörter stimmen nicht überein.",
    );
  });

  it("accepts matching passwords with at least six characters", () => {
    expect(validateNewPassword("abcdef", "abcdef")).toBeNull();
  });
});

describe("forgot-password email validation", () => {
  it("requires a syntactically valid email address", () => {
    expect(isValidEmailAddress(" ")).toBe(false);
    expect(isValidEmailAddress("harald@findog")).toBe(false);
    expect(isValidEmailAddress("harald@findog.at")).toBe(true);
  });
});

describe("public auth surface", () => {
  it("contains no self-service registration or signUp path", () => {
    const pagePath = fileURLToPath(new URL("../../app/page.tsx", import.meta.url));
    const source = readFileSync(pagePath, "utf8");

    expect(source).not.toMatch(/\bsignUp\b/);
    expect(source).not.toMatch(/sign-up|Registrier/);
  });
});
