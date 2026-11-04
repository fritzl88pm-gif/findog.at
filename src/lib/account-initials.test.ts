import { describe, expect, it } from "vitest";

import { getAccountInitials } from "@/lib/account-initials";

describe("getAccountInitials", () => {
  it("uses the first letters of the first two name parts", () => {
    expect(getAccountInitials("harald.fritz@example.com")).toBe("HF");
    expect(getAccountInitials("max_mustermann+tax@example.com")).toBe("MM");
  });

  it("uses the first two letters of a single-word local part and ignores digits", () => {
    expect(getAccountInitials("fritzl88@example.com")).toBe("FR");
    expect(getAccountInitials("x@example.com")).toBe("X");
  });

  it("falls back to a placeholder without a usable email", () => {
    expect(getAccountInitials("")).toBe("?");
    expect(getAccountInitials(null)).toBe("?");
    expect(getAccountInitials(undefined)).toBe("?");
    expect(getAccountInitials("123@example.com")).toBe("?");
  });
});
