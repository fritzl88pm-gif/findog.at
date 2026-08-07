/** Builds a user personalization block from admin-managed prompt text. */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeXmlText(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

function buildNameLine(name: string): string {
  return `Der Benutzer möchte mit dem Namen \u201e${escapeXmlText(name)}\u201c angesprochen werden. Verwende den Namen natürlich und sparsam.`;
}

const FOOTER_LINE =
  "Diese Personalisierung betrifft nur Ansprache und Kommunikationsstil. Freds fachliche, rechtliche, Quellen-, Werkzeug- und Sicherheitsvorgaben haben stets Vorrang.";

/**
 * Build a deterministic, short `<user_personalization>` block for injection
 * into the WeKnora upstream query only. Returns an empty string when both
 * the prompt text is empty AND no preferred name is set.
 *
 * @param prefs.promptText — trusted admin prompt text (already normalized);
 *   empty string means no style prompt. Non-empty values are inserted verbatim.
 * @param prefs.preferredName — user-specified name; always XML-escaped.
 */
export function buildUserPersonalizationBlock(prefs: {
  promptText: string;
  preferredName: string | null;
}): string {
  const promptText = prefs.promptText ?? "";
  const name = (prefs.preferredName ?? "").trim();

  const hasName = name.length > 0;
  const hasStyle = promptText.length > 0;

  if (!hasName && !hasStyle) return "";

  const lines: string[] = [];

  if (hasName) {
    lines.push(buildNameLine(name));
  }

  if (hasStyle) {
    // Admin prompt text is inserted verbatim as trusted configuration
    lines.push("Kommunikationsstil: " + promptText);
  }

  lines.push(FOOTER_LINE);

  return `<user_personalization>\n${lines.join("\n")}\n</user_personalization>`;
}
