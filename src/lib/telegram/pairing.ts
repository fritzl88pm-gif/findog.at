import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a 32-byte random webhook secret token, base64url-encoded */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Generate a 32-byte random pairing token, base64url-encoded, at most 64 chars */
export function generatePairingToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Compute the SHA-256 hex digest of a token */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe comparison of two SHA-256 hex digest strings.
 * Falls back to crypto.timingSafeEqual for same-length strings;
 * for different lengths, does a constant-time check that still returns false.
 */
export function timingSafeDigestEqual(a: string, b: string): boolean {
  // Different lengths: cannot use timingSafeEqual directly, but we still
  // want to avoid leaking length info. We compare equal-length buffers
  // after padding the shorter one with zeros (constant-time).
  if (a.length !== b.length) {
    // Produce a constant-time false without leaking which string is shorter.
    // We hash both and compare the hashes so that the timing is independent.
    const hashA = Buffer.from(hashToken(a), "hex");
    const hashB = Buffer.from(hashToken(b), "hex");
    try {
      return timingSafeEqual(hashA, hashB);
    } catch {
      return false;
    }
  }

  // Same length: standard timing-safe compare.
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
