export const DEFAULT_MAX_URL_LENGTH = 2_048;
export const DEFAULT_MAX_LABEL_LENGTH = 512;
export const DEFAULT_MAX_ID_LENGTH = 128;
export const DEFAULT_MAX_DETAIL_CHARS = 2_000;

const SENSITIVE_QUERY_SEGMENTS = new Set([
  "token",
  "tokens",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "password",
  "passwords",
  "passwd",
  "passwds",
  "signature",
  "signatures",
  "sig",
  "sigs",
  "jwt",
  "jwts",
  "auth",
  "authorization",
  "authorizations",
  "authentication",
  "authentications",
  "key",
  "keys",
  "apikey",
  "apikeys",
]);

const INTENTIONALLY_SAFE_QUERY_KEYS = new Set([
  "signature_version",
  "sig_version",
]);

const SENSITIVE_COMPOUND_QUERY_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "authtoken",
  "idtoken",
  "sessiontoken",
]);

const INTERNAL_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
  ".corp",
  ".home",
  ".intra",
  ".localhost",
  ".service",
];

export function sanitizeControlCharacters(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function isSensitiveQueryParam(rawKey: string): boolean {
  if (typeof rawKey !== "string") return false;
  const trimmed = rawKey.trim();
  if (!trimmed) return false;

  // Split camelCase before lowercasing: "accessToken" -> "access Token", "OAuth2Token" -> "O Auth 2 Token"
  const separated = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, "$1 $2");

  // Turn bracket/nested notation, punctuation, hyphens, and underscores into segment separators
  const withSpaces = separated.replace(/[^a-zA-Z0-9]+/g, " ");

  // Collapse separators and lowercase segments
  const segments = withSpaces.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (segments.length === 0) return false;

  const joinedKey = segments.join("_");
  if (INTENTIONALLY_SAFE_QUERY_KEYS.has(joinedKey)) {
    return false;
  }

  if (SENSITIVE_COMPOUND_QUERY_KEYS.has(segments.join(""))) {
    return true;
  }

  for (const segment of segments) {
    if (SENSITIVE_QUERY_SEGMENTS.has(segment)) {
      return true;
    }
  }

  return false;
}

export function isPrivateOrLocalIpv4(parts: string[]): boolean {
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [o0, o1] = octets;
  // 0.0.0.0/8 (current network)
  if (o0 === 0) return true;
  // 10.0.0.0/8 (private)
  if (o0 === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (o0 === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (o0 === 169 && o1 === 254) return true;
  // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
  // 192.168.0.0/16 (private)
  if (o0 === 192 && o1 === 168) return true;
  // 100.64.0.0/10 (carrier-grade NAT: 100.64.0.0 - 100.127.255.255)
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;
  // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved) & 255.255.255.255 (broadcast)
  if (o0 >= 224) return true;
  return false;
}

export function parseIpv6Words(host: string): number[] | null {
  let h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const zoneIndex = h.indexOf("%");
  if (zoneIndex >= 0) {
    h = h.slice(0, zoneIndex);
  }
  let hexPart = h;
  const embeddedIpv4: number[] = [];
  if (h.includes(".")) {
    const lastColon = h.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4Str = h.slice(lastColon + 1);
    const octets = ipv4Str.split(".");
    if (octets.length !== 4) return null;
    const nums = octets.map((o) => Number(o));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255 || !/^\d+$/.test(octets[nums.indexOf(n)]))) {
      return null;
    }
    embeddedIpv4.push((nums[0] << 8) | nums[1], (nums[2] << 8) | nums[3]);
    hexPart = h.slice(0, lastColon);
  }

  const doubleColonIndex = hexPart.indexOf("::");
  if (doubleColonIndex >= 0) {
    if (hexPart.indexOf("::", doubleColonIndex + 2) >= 0) {
      return null;
    }
    const leftStr = hexPart.slice(0, doubleColonIndex);
    const rightStr = hexPart.slice(doubleColonIndex + 2);
    const leftWords = leftStr ? leftStr.split(":").map((w) => (/^[0-9a-f]{1,4}$/.test(w) ? parseInt(w, 16) : NaN)) : [];
    const rightWords = rightStr ? rightStr.split(":").map((w) => (/^[0-9a-f]{1,4}$/.test(w) ? parseInt(w, 16) : NaN)) : [];
    if (leftWords.some(Number.isNaN) || rightWords.some(Number.isNaN)) return null;
    const totalWords = leftWords.length + rightWords.length + embeddedIpv4.length;
    if (totalWords > 8) return null;
    const missing = 8 - totalWords;
    return [...leftWords, ...Array(missing).fill(0), ...rightWords, ...embeddedIpv4];
  } else {
    const words = (hexPart ? hexPart.split(":") : []).map((w) => (/^[0-9a-f]{1,4}$/.test(w) ? parseInt(w, 16) : NaN));
    if (words.some(Number.isNaN)) return null;
    const allWords = [...words, ...embeddedIpv4];
    if (allWords.length !== 8) return null;
    return allWords;
  }
}

export function isPrivateOrLocalIpv6(host: string): boolean {
  const words = parseIpv6Words(host);
  if (!words) return true;

  const [w0, w1, w2, w3, w4, w5, w6, w7] = words;

  // Loopback (::1) or Unspecified (::)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0 && (w7 === 0 || w7 === 1)) {
    return true;
  }

  // IPv4-compatible IPv6 (::/96)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
    const o0 = (w6 >> 8) & 0xff;
    const o1 = w6 & 0xff;
    const o2 = (w7 >> 8) & 0xff;
    const o3 = w7 & 0xff;
    if (isPrivateOrLocalIpv4([String(o0), String(o1), String(o2), String(o3)])) {
      return true;
    }
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0xffff) {
    const o0 = (w6 >> 8) & 0xff;
    const o1 = w6 & 0xff;
    const o2 = (w7 >> 8) & 0xff;
    const o3 = w7 & 0xff;
    if (isPrivateOrLocalIpv4([String(o0), String(o1), String(o2), String(o3)])) {
      return true;
    }
  }

  // Link-local: fe80::/10 (fe80 to febf)
  if ((w0 & 0xffc0) === 0xfe80) return true;

  // Unique Local Address (ULA): fc00::/7 (fc00 to fdff)
  if ((w0 & 0xfe00) === 0xfc00) return true;

  // Multicast: ff00::/8
  if ((w0 & 0xff00) === 0xff00) return true;

  // Documentation: 2001:db8::/32
  if (w0 === 0x2001 && w1 === 0x0db8) return true;

  return false;
}

export function isDisallowedHostname(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!clean) return true;
  if (clean === "localhost" || clean.endsWith(".localhost")) return true;
  if (INTERNAL_HOST_SUFFIXES.some((suffix) => clean.endsWith(suffix))) return true;
  // IPv4 check
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(clean)) {
    return isPrivateOrLocalIpv4(clean.split("."));
  }
  // IPv6 check
  if (clean.includes(":")) {
    return isPrivateOrLocalIpv6(clean);
  }
  // Single-label hostname without dot (e.g. "intranet", "nas", "router", "myserver")
  if (!clean.includes(".")) {
    return true;
  }
  return false;
}

export function sanitizePublicSourceUrl(raw: unknown, maxLength = DEFAULT_MAX_URL_LENGTH): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // Protocol check: only http and https
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Userinfo check: reject if username or password is present
  if (url.username || url.password) return null;
  // Hostname check
  if (isDisallowedHostname(url.hostname)) return null;
  // Query parameter check: reject sensitive param names
  for (const [key] of url.searchParams) {
    if (isSensitiveQueryParam(key)) {
      return null;
    }
  }
  // Strip URL fragments before persistence
  url.hash = "";
  const result = url.toString();
  if (result.length > maxLength) return null;
  return result;
}

function redactUrlsInText(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, (candidate) => {
    const match = candidate.match(/^(.+?)([.,;:!?)]*)$/);
    const candidateUrl = match ? match[1] : candidate;
    const trailingPunc = match ? match[2] : "";

    const safeUrl = sanitizePublicSourceUrl(candidateUrl);
    if (safeUrl) {
      return safeUrl + trailingPunc;
    }
    return `[REDACTED_URL]${trailingPunc}`;
  });
}

function redactSensitiveAssignments(text: string): string {
  return text.replace(
    /\b([A-Za-z][A-Za-z0-9_.\-[\]]{0,80})(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/g,
    (match, rawKey: string) => isSensitiveQueryParam(rawKey) ? "[REDACTED]" : match,
  );
}

export function redactSensitiveText(input: string): string {
  // 1. Locate and sanitize/redact http(s) URLs in detail text FIRST
  const textWithRedactedUrls = redactUrlsInText(input);

  // 2. Apply the same normalized credential-key policy to standalone assignments.
  const textWithRedactedAssignments = redactSensitiveAssignments(textWithRedactedUrls);

  // 3. Redact credentials, tokens, connections, paths, and storage URIs
  return textWithRedactedAssignments
    // Bearer / Authorization tokens
    .replace(/\bBearer\s+[A-Za-z0-9_\-\.~+/]+=*/gi, "Bearer [REDACTED]")
    // API keys with standard prefixes
    .replace(/\b(?:sk|key|glpat|xox[baprs])-[A-Za-z0-9_\-]{8,}/gi, "[REDACTED_API_KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{20,})/g, "[REDACTED_API_KEY]")
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}/gi, "[REDACTED_API_KEY]")
    .replace(/\b(?:sk_live|sk_test)_[A-Za-z0-9]{16,}/gi, "[REDACTED_API_KEY]")
    // Secret / password / credential key-value assignments
    .replace(/\b(?:api[_-]?key|secret(?:[_-]?key)?|password|passwd|auth[_-]?token|access[_-]?token)[A-Za-z0-9_]*\s*[:=]\s*['"]?[^\s,'">]+['"]?/gi, "[REDACTED]")
    // JWT tokens
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    // Database connection strings
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|cockroachdb):\/\/[^\s]+/gi, "[REDACTED_CONNECTION]")
    // Private storage URIs
    .replace(/\b(?:s3|gs|gcs|azure|blob|oss|cos|minio):\/\/[^\s]+/gi, "[REDACTED_STORAGE_URI]")
    // Local filesystem paths
    .replace(/(?:\/(?:var|tmp|etc|proc|sys|opt|home|root|usr|private|Users)\/[^\s'"]+)/gi, "[REDACTED_PATH]")
    .replace(/\b[A-Za-z]:\\[^\s'"]+/g, "[REDACTED_PATH]");
}

export function sanitizeSafeLabel(value: unknown, maxLength = DEFAULT_MAX_LABEL_LENGTH): string {
  if (typeof value !== "string") return "";
  const cleaned = sanitizeControlCharacters(value).trim();
  if (!cleaned) return "";
  const redacted = redactSensitiveText(cleaned);
  return redacted.slice(0, maxLength).trim();
}

export function sanitizeSafeId(value: unknown, maxLength = DEFAULT_MAX_ID_LENGTH): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const str = String(value);
  const cleaned = sanitizeControlCharacters(str).trim();
  if (!cleaned) return undefined;
  const redacted = redactSensitiveText(cleaned);
  const bounded = redacted.slice(0, maxLength).trim();
  return bounded || undefined;
}

export function sanitizeAndRedactDetail(value: unknown, maxLength = DEFAULT_MAX_DETAIL_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeControlCharacters(value);
  if (!sanitized.trim()) return undefined;
  const redacted = redactSensitiveText(sanitized);
  const bounded = redacted.slice(0, maxLength);
  return bounded || undefined;
}
