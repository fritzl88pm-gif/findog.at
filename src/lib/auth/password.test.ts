import { describe, expect, it } from "vitest";

import { UserVisibleError } from "@/lib/errors";
import { parsePasswordChangeBody } from "@/lib/auth/password";

describe("password-change validation", () => {
  it("requires the current password", () => {
    expect(() => parsePasswordChangeBody({
      currentPassword: "",
      newPassword: "abcdef",
      confirmation: "abcdef",
    })).toThrowError("Bitte aktuelles Passwort eingeben.");
  });

  it("requires the new password and confirmation", () => {
    expect(() => parsePasswordChangeBody({
      currentPassword: "aktuell",
      newPassword: "",
      confirmation: "",
    })).toThrowError("Bitte neues Passwort und Bestätigung eingeben.");
  });

  it("requires at least six characters", () => {
    expect(() => parsePasswordChangeBody({
      currentPassword: "aktuell",
      newPassword: "kurz",
      confirmation: "kurz",
    })).toThrowError("Das neue Passwort muss mindestens 6 Zeichen lang sein.");
  });

  it("requires matching new passwords", () => {
    expect(() => parsePasswordChangeBody({
      currentPassword: "aktuell",
      newPassword: "abcdef",
      confirmation: "abcdefg",
    })).toThrowError("Die neuen Passwörter stimmen nicht überein.");
  });

  it("strictly rejects missing, extra, or non-string fields", () => {
    const invalidBodies = [
      null,
      [],
      { currentPassword: "aktuell", newPassword: "abcdef" },
      {
        currentPassword: "aktuell",
        newPassword: "abcdef",
        confirmation: "abcdef",
        userId: "other-user",
      },
      { currentPassword: 123456, newPassword: "abcdef", confirmation: "abcdef" },
    ];

    for (const body of invalidBodies) {
      try {
        parsePasswordChangeBody(body);
        throw new Error("expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(UserVisibleError);
        expect(error).toMatchObject({ status: 400 });
      }
    }
  });

  it("returns only the three accepted password values", () => {
    expect(parsePasswordChangeBody({
      currentPassword: "aktuell",
      newPassword: "abcdef",
      confirmation: "abcdef",
    })).toEqual({
      currentPassword: "aktuell",
      newPassword: "abcdef",
      confirmation: "abcdef",
    });
  });
});
