/** Initials (max. two letters) for the account avatar, derived from the signed-in email. */
export function getAccountInitials(email: string | null | undefined): string {
  const localPart = (email ?? "").trim().split("@")[0] ?? "";
  const words = localPart
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);

  if (words.length === 0) return "?";
  const letters = words.length === 1
    ? Array.from(words[0]).slice(0, 2)
    : [Array.from(words[0])[0], Array.from(words[1])[0]];
  return letters.join("").toLocaleUpperCase("de-AT");
}
