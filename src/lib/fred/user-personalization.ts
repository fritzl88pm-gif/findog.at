/** Personality values as stored in public.fred_user_preferences. */
export type FredPersonality = "standard" | "friendly" | "efficient" | "cynical";

/** Normalized user preferences returned by the API layer. */
export interface FredUserPreferences {
  preferredName: string;
  personality: FredPersonality;
}

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

const STYLE_LINES: Record<Exclude<FredPersonality, "standard">, string> = {
  friendly:
    "Kommunikationsstil: Antworte herzlich, zugewandt und gesprächig. Verwende häufiger passende Emojis, ohne die fachliche Präzision oder Vollständigkeit zu beeinträchtigen.",
  efficient:
    "Kommunikationsstil: Antworte prägnant, direkt und klar. Konzentriere dich auf die entscheidenden Informationen und vermeide unnötige Einleitungen oder Wiederholungen.",
  cynical:
    "Kommunikationsstil: Antworte kritisch, trocken und sarkastisch. Der Sarkasmus darf pointiert sein, darf aber die fachliche Präzision und Klarheit nicht beeinträchtigen.",
};

const PRECEDENCE_LINE =
  "Diese Personalisierung betrifft nur Ansprache und Kommunikationsstil. Freds fachliche, rechtliche, Quellen-, Werkzeug- und Sicherheitsvorgaben haben stets Vorrang.";

/**
 * Build a deterministic, short `<user_personalization>` block for injection
 * into the WeKnora upstream query only. Returns an empty string when both the
 * personality is standard AND no preferred name is set, because in that case
 * no personalization is required.
 */
export function buildUserPersonalizationBlock(prefs: {
  personality: FredPersonality;
  preferredName: string | null;
}): string {
  const personality = prefs.personality;
  const name = (prefs.preferredName ?? "").trim();

  const hasName = name.length > 0;
  const hasStyle = personality !== "standard";

  if (!hasName && !hasStyle) return "";

  const lines: string[] = [];

  if (hasName) {
    lines.push(buildNameLine(name));
  }

  if (hasStyle) {
    lines.push(STYLE_LINES[personality]);
  }

  lines.push(PRECEDENCE_LINE);

  return `<user_personalization>\n${lines.join("\n")}\n</user_personalization>`;
}
