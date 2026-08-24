import { describe, expect, it } from "vitest";

import {
  isDisallowedHostname,
  isSensitiveQueryParam,
  redactSensitiveText,
  sanitizeAndRedactDetail,
  sanitizeControlCharacters,
  sanitizePublicSourceUrl,
  sanitizeSafeId,
  sanitizeSafeLabel,
} from "./safe-research-display";

describe("Safe Research Display & Sanitization Helper", () => {
  describe("isSensitiveQueryParam", () => {
    it("rejects camelCase sensitive parameters", () => {
      expect(isSensitiveQueryParam("accessToken")).toBe(true);
      expect(isSensitiveQueryParam("refreshToken")).toBe(true);
      expect(isSensitiveQueryParam("clientSecret")).toBe(true);
      expect(isSensitiveQueryParam("apiKey")).toBe(true);
      expect(isSensitiveQueryParam("adminPassword")).toBe(true);
      expect(isSensitiveQueryParam("userPasswd")).toBe(true);
      expect(isSensitiveQueryParam("authSignature")).toBe(true);
    });

    it("rejects bracket and nested query notation", () => {
      expect(isSensitiveQueryParam("auth[token]")).toBe(true);
      expect(isSensitiveQueryParam("auth[user][token]")).toBe(true);
      expect(isSensitiveQueryParam("token[]")).toBe(true);
      expect(isSensitiveQueryParam("token[0]")).toBe(true);
      expect(isSensitiveQueryParam("credentials[api_key]")).toBe(true);
    });

    it("rejects plural and singular forms of credential terms at segment boundaries", () => {
      expect(isSensitiveQueryParam("token")).toBe(true);
      expect(isSensitiveQueryParam("tokens")).toBe(true);
      expect(isSensitiveQueryParam("secret")).toBe(true);
      expect(isSensitiveQueryParam("secrets")).toBe(true);
      expect(isSensitiveQueryParam("credential")).toBe(true);
      expect(isSensitiveQueryParam("credentials")).toBe(true);
      expect(isSensitiveQueryParam("password")).toBe(true);
      expect(isSensitiveQueryParam("passwords")).toBe(true);
      expect(isSensitiveQueryParam("passwd")).toBe(true);
      expect(isSensitiveQueryParam("passwds")).toBe(true);
      expect(isSensitiveQueryParam("sig")).toBe(true);
      expect(isSensitiveQueryParam("sigs")).toBe(true);
      expect(isSensitiveQueryParam("signature")).toBe(true);
      expect(isSensitiveQueryParam("signatures")).toBe(true);
      expect(isSensitiveQueryParam("jwt")).toBe(true);
      expect(isSensitiveQueryParam("jwts")).toBe(true);
      expect(isSensitiveQueryParam("auth")).toBe(true);
      expect(isSensitiveQueryParam("authorization")).toBe(true);
      expect(isSensitiveQueryParam("authorizations")).toBe(true);
      expect(isSensitiveQueryParam("authentication")).toBe(true);
      expect(isSensitiveQueryParam("authentications")).toBe(true);
      expect(isSensitiveQueryParam("key")).toBe(true);
      expect(isSensitiveQueryParam("keys")).toBe(true);
      expect(isSensitiveQueryParam("apikey")).toBe(true);
      expect(isSensitiveQueryParam("apikeys")).toBe(true);
    });

    it("rejects lowercase and uppercase compound credential parameters", () => {
      for (const key of [
        "accesstoken",
        "ACCESSTOKEN",
        "refreshtoken",
        "clientsecret",
        "authtoken",
        "idtoken",
        "sessiontoken",
      ]) {
        expect(isSensitiveQueryParam(key)).toBe(true);
      }
    });

    it("allows benign query parameters", () => {
      expect(isSensitiveQueryParam("monkey")).toBe(false);
      expect(isSensitiveQueryParam("tokenizer")).toBe(false);
      expect(isSensitiveQueryParam("signature_version")).toBe(false);
      expect(isSensitiveQueryParam("sig_version")).toBe(false);
      expect(isSensitiveQueryParam("page")).toBe(false);
      expect(isSensitiveQueryParam("query")).toBe(false);
      expect(isSensitiveQueryParam("author")).toBe(false);
      expect(isSensitiveQueryParam("authority")).toBe(false);
      expect(isSensitiveQueryParam("keyword")).toBe(false);
      expect(isSensitiveQueryParam("keyboard")).toBe(false);
      expect(isSensitiveQueryParam("sort")).toBe(false);
      expect(isSensitiveQueryParam("order")).toBe(false);
    });
  });

  describe("isDisallowedHostname", () => {
    it("disallows localhost, trailing-dot variants, and internal suffixes", () => {
      expect(isDisallowedHostname("localhost")).toBe(true);
      expect(isDisallowedHostname("localhost.")).toBe(true);
      expect(isDisallowedHostname("api.localhost.")).toBe(true);
      expect(isDisallowedHostname("service.local")).toBe(true);
      expect(isDisallowedHostname("service.local.")).toBe(true);
      expect(isDisallowedHostname("db.internal")).toBe(true);
      expect(isDisallowedHostname("db.internal.")).toBe(true);
      expect(isDisallowedHostname("intranet.lan")).toBe(true);
      expect(isDisallowedHostname("portal.corp")).toBe(true);
      expect(isDisallowedHostname("nas.home")).toBe(true);
      expect(isDisallowedHostname("app.service")).toBe(true);
      expect(isDisallowedHostname("singlelabelhost")).toBe(true);
      expect(isDisallowedHostname("nas.")).toBe(true);
    });

    it("disallows private and loopback IPv4 addresses", () => {
      expect(isDisallowedHostname("127.0.0.1")).toBe(true);
      expect(isDisallowedHostname("127.0.0.1.")).toBe(true);
      expect(isDisallowedHostname("10.0.0.1")).toBe(true);
      expect(isDisallowedHostname("192.168.1.1")).toBe(true);
      expect(isDisallowedHostname("172.16.0.1")).toBe(true);
      expect(isDisallowedHostname("169.254.169.254")).toBe(true);
      expect(isDisallowedHostname("100.64.0.1")).toBe(true);
      expect(isDisallowedHostname("0.0.0.0")).toBe(true);
    });

    it("disallows private, loopback, and mapped IPv6 addresses", () => {
      expect(isDisallowedHostname("::1")).toBe(true);
      expect(isDisallowedHostname("[::1]")).toBe(true);
      expect(isDisallowedHostname("fe80::1")).toBe(true);
      expect(isDisallowedHostname("fc00::1")).toBe(true);
      expect(isDisallowedHostname("fd12:3456:789a::1")).toBe(true);
      expect(isDisallowedHostname("::ffff:127.0.0.1")).toBe(true);
      expect(isDisallowedHostname("::ffff:10.0.0.1")).toBe(true);
      expect(isDisallowedHostname("::a00:1")).toBe(true);
      expect(isDisallowedHostname("::7f00:1")).toBe(true);
    });

    it("allows valid public hostnames", () => {
      expect(isDisallowedHostname("ris.bka.gv.at")).toBe(false);
      expect(isDisallowedHostname("findok.bmf.gv.at")).toBe(false);
      expect(isDisallowedHostname("www.bmf.gv.at")).toBe(false);
      expect(isDisallowedHostname("example.com")).toBe(false);
      expect(isDisallowedHostname("93.184.216.34")).toBe(false);
    });
  });

  describe("sanitizePublicSourceUrl", () => {
    it("sanitizes safe public URLs and strips fragments", () => {
      const url = "https://ris.bka.gv.at/Dokument.wxe?id=123#section-2";
      expect(sanitizePublicSourceUrl(url)).toBe("https://ris.bka.gv.at/Dokument.wxe?id=123");
    });

    it("rejects non-http/https protocols", () => {
      expect(sanitizePublicSourceUrl("javascript:alert(1)")).toBeNull();
      expect(sanitizePublicSourceUrl("data:text/html,test")).toBeNull();
      expect(sanitizePublicSourceUrl("file:///etc/passwd")).toBeNull();
      expect(sanitizePublicSourceUrl("ftp://example.com")).toBeNull();
    });

    it("rejects URLs with credentials or sensitive query keys", () => {
      expect(sanitizePublicSourceUrl("https://user:pass@example.com/page")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?accessToken=secret")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?clientSecret=sec")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/auth?auth[token]=tok")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?credentials=cred")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?accesstoken=secret")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?REFRESHTOKEN=secret")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?clientsecret=secret")).toBeNull();
      expect(sanitizePublicSourceUrl("https://example.com/api?authtoken=secret")).toBeNull();
    });
  });

  describe("redactSensitiveText and sanitizeAndRedactDetail", () => {
    it("redacts internal URLs and URLs with sensitive queries inside text", () => {
      const input = "Internal: http://[::1]/api and https://service.local/data and https://example.com/oauth?accessToken=xyz";
      const redacted = redactSensitiveText(input);
      expect(redacted).not.toContain("http://[::1]");
      expect(redacted).not.toContain("https://service.local");
      expect(redacted).not.toContain("accessToken=xyz");
      expect(redacted).toBe("Internal: [REDACTED_URL] and [REDACTED_URL] and [REDACTED_URL]");
    });

    it("preserves safe public URLs and normal German text", () => {
      const input = "Hier ist die Quelle: https://ris.bka.gv.at/Dokument.wxe?id=456. Gemäß § 16 EStG 1988 gilt das.";
      const redacted = redactSensitiveText(input);
      expect(redacted).toBe("Hier ist die Quelle: https://ris.bka.gv.at/Dokument.wxe?id=456. Gemäß § 16 EStG 1988 gilt das.");
    });

    it("redacts normalized standalone credential assignments", () => {
      for (const input of [
        "clientSecret=cs123",
        "clientsecret=cs123",
        "refreshToken=rt123",
        "refreshtoken=rt123",
        "credentials=creds123",
        "auth[token]=tok123",
      ]) {
        expect(redactSensitiveText(input)).toBe("[REDACTED]");
        expect(sanitizeSafeLabel(input)).toBe("[REDACTED]");
        expect(sanitizeAndRedactDetail(input)).toBe("[REDACTED]");
      }
    });

    it("sanitizes control characters and bounds output", () => {
      expect(sanitizeControlCharacters("A\x00B\r\nC\x1FD")).toBe("AB\nCD");
      expect(sanitizeSafeLabel("  Valid Label\x00  ", 10)).toBe("Valid Labe");
      expect(sanitizeSafeId("id-123\x08", 50)).toBe("id-123");
      expect(sanitizeAndRedactDetail("Some detail text", 11)).toBe("Some detail");
      expect(sanitizeAndRedactDetail("   ")).toBeUndefined();
    });
  });
});
