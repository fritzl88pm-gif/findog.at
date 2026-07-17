export type FinalReferenceKind =
  | "bfg_gz"
  | "ecli"
  | "citation_label"
  | "paragraph"
  | "margin_number"
  | "amount_year";

type BaseReferenceToken = {
  kind: FinalReferenceKind;
  raw: string;
  normalized: string;
};

export type FinalReferenceToken =
  | (BaseReferenceToken & { kind: "bfg_gz" | "ecli" | "citation_label" })
  | (BaseReferenceToken & {
      kind: "paragraph";
      section: string;
      subsection?: string;
      item?: string;
      letter?: string;
      law?: string;
    })
  | (BaseReferenceToken & {
      kind: "margin_number";
      start: string;
      end?: string;
      following: boolean;
      document?: string;
    })
  | (BaseReferenceToken & {
      kind: "amount_year";
      currency: "EUR";
      amountCents: number;
      year?: string;
    });

export interface InternalEvidenceText {
  evidenceId: string;
  text: string;
  /** Citation labels assigned by the server, with or without square brackets. */
  citationLabels?: readonly string[];
}

export interface FinalReferenceCheck {
  token: FinalReferenceToken;
  supportedByEvidenceIds: readonly string[];
}

export interface FinalReferenceValidationResult {
  supported: boolean;
  answerTokens: readonly FinalReferenceToken[];
  evidenceTokens: readonly FinalReferenceToken[];
  checks: readonly FinalReferenceCheck[];
  unsupportedTokens: readonly FinalReferenceToken[];
}

type PositionedToken = {
  index: number;
  token: FinalReferenceToken;
};

const BFG_GZ_PATTERN = /\b(?:RV|RS|RM|AW|VH)\/[0-9A-Z-]+\/(?:19|20)\d{2}\b/giu;
const ECLI_PATTERN = /\bECLI:AT:BFG:(?:19|20)\d{2}:[A-Z0-9._-]+\b/giu;
const CITATION_LABEL_PATTERN = /\[Q\d+\]/giu;
const LAW_PATTERN = "(?:EStG(?:\\s*1988)?|UStG(?:\\s*1994)?|KStG(?:\\s*1988)?|FLAG(?:\\s*1967)?|BAO|B-VG|FinStrG|VwGG|VfGG|GebG|GrEStG|NoVAG|UmgrStG)";
const PARAGRAPH_PATTERN = new RegExp(
  `\\u00A7{1,2}\\s*(?<section>\\d+[a-z]?)`
    + `(?:\\s*(?:Abs\\.?|Absatz)\\s*(?<subsection>\\d+[a-z]?))?`
    + `(?:\\s*(?:Z\\.?|Ziffer)\\s*(?<item>\\d+[a-z]?))?`
    + `(?:\\s*(?:lit\\.?|Litera)\\s*(?<letter>[a-z]))?`
    + `(?:\\s*(?<law>${LAW_PATTERN}))?`,
  "giu",
);
const MARGIN_NUMBER_PATTERN = /(?:(?<document>LStR|EStR|UStR|KStR)\s+)?\bRz\.?\s*(?<start>\d+[a-z]?)(?:\s*(?:-|\u2013|bis)\s*(?<end>\d+[a-z]?))?(?<following>\s*ff\.?)?/giu;
const AMOUNT_NUMBER_PATTERN = "(?:\\d{1,3}(?:[.,\\s'\\u2019]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const AMOUNT_PATTERN = new RegExp(
  `(?:(?<currencyBefore>\\u20AC|EUR)\\s*(?<amountBefore>${AMOUNT_NUMBER_PATTERN})`
    + `|(?<amountAfter>${AMOUNT_NUMBER_PATTERN})\\s*(?<currencyAfter>\\u20AC|Euro|EUR))`,
  "giu",
);
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/gu;

function canonicalUpper(value: string): string {
  return value.replace(/\s+/gu, "").toLocaleUpperCase("de-AT");
}

function normalizeCitationLabel(value: string): string | undefined {
  const match = value.trim().match(/^\[?Q(\d+)\]?$/iu);
  return match ? `Q${match[1]}` : undefined;
}

function normalizeAmountToCents(value: string): number | undefined {
  let normalized = value.replace(/[\s'\u2019]/gu, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  let decimalSeparator: "," | "." | undefined;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    const decimalLength = normalized.length - lastComma - 1;
    if (decimalLength <= 2) decimalSeparator = ",";
  } else if (lastDot >= 0) {
    const decimalLength = normalized.length - lastDot - 1;
    if (decimalLength <= 2) decimalSeparator = ".";
  }

  if (decimalSeparator) {
    const separatorIndex = normalized.lastIndexOf(decimalSeparator);
    const integerPart = normalized.slice(0, separatorIndex).replace(/[.,]/gu, "");
    const decimalPart = normalized.slice(separatorIndex + 1).padEnd(2, "0").slice(0, 2);
    normalized = `${integerPart}.${decimalPart}`;
  } else {
    normalized = normalized.replace(/[.,]/gu, "");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return undefined;
  }
  return Math.round(amount * 100);
}

function closestYear(text: string, amountIndex: number, amountLength: number): string | undefined {
  const allCandidates = [...text.matchAll(YEAR_PATTERN)]
    .map((match) => ({ year: match[0], index: match.index }));
  const boundaryBefore = Math.max(
    text.lastIndexOf("\n", amountIndex - 1),
    text.lastIndexOf(";", amountIndex - 1),
    text.lastIndexOf(".", amountIndex - 1),
    text.lastIndexOf("!", amountIndex - 1),
    text.lastIndexOf("?", amountIndex - 1),
  );
  const followingBoundaries = ["\n", ";", ".", "!", "?"]
    .map((boundary) => text.indexOf(boundary, amountIndex + amountLength))
    .filter((index) => index >= 0);
  const boundaryAfter = followingBoundaries.length > 0
    ? Math.min(...followingBoundaries)
    : text.length;
  const sameSegment = allCandidates.filter((candidate) => (
    candidate.index > boundaryBefore && candidate.index < boundaryAfter
  ));
  const candidates = (sameSegment.length > 0 ? sameSegment : allCandidates)
    .filter((candidate) => {
      const distance = candidate.index < amountIndex
        ? amountIndex - (candidate.index + candidate.year.length)
        : candidate.index - (amountIndex + amountLength);
      return distance <= 120;
    })
    .sort((left, right) => {
      const leftDistance = Math.min(
        Math.abs(left.index - amountIndex),
        Math.abs(left.index - (amountIndex + amountLength)),
      );
      const rightDistance = Math.min(
        Math.abs(right.index - amountIndex),
        Math.abs(right.index - (amountIndex + amountLength)),
      );
      return leftDistance - rightDistance || left.index - right.index;
    });
  return candidates[0]?.year;
}

function exactTokens(
  text: string,
  pattern: RegExp,
  kind: "bfg_gz" | "ecli" | "citation_label",
): PositionedToken[] {
  return [...text.matchAll(pattern)].flatMap((match) => {
    const normalized = kind === "citation_label"
      ? normalizeCitationLabel(match[0])
      : canonicalUpper(match[0]);
    return normalized
      ? [{
          index: match.index,
          token: { kind, raw: match[0], normalized },
        }]
      : [];
  });
}

function paragraphTokens(text: string): PositionedToken[] {
  return [...text.matchAll(PARAGRAPH_PATTERN)].map((match) => {
    const groups = match.groups ?? {};
    const section = canonicalUpper(groups.section ?? "");
    const subsection = groups.subsection ? canonicalUpper(groups.subsection) : undefined;
    const item = groups.item ? canonicalUpper(groups.item) : undefined;
    const letter = groups.letter ? canonicalUpper(groups.letter) : undefined;
    const law = groups.law ? canonicalUpper(groups.law) : undefined;
    const normalized = [
      `\u00A7${section}`,
      subsection ? `ABS${subsection}` : "",
      item ? `Z${item}` : "",
      letter ? `LIT${letter}` : "",
      law ?? "",
    ].filter(Boolean).join(":");
    return {
      index: match.index,
      token: {
        kind: "paragraph" as const,
        raw: match[0],
        normalized,
        section,
        ...(subsection ? { subsection } : {}),
        ...(item ? { item } : {}),
        ...(letter ? { letter } : {}),
        ...(law ? { law } : {}),
      },
    };
  });
}

function marginNumberTokens(text: string): PositionedToken[] {
  return [...text.matchAll(MARGIN_NUMBER_PATTERN)].map((match) => {
    const groups = match.groups ?? {};
    const start = canonicalUpper(groups.start ?? "");
    const end = groups.end ? canonicalUpper(groups.end) : undefined;
    const document = groups.document ? canonicalUpper(groups.document) : undefined;
    const following = Boolean(groups.following?.trim());
    return {
      index: match.index,
      token: {
        kind: "margin_number" as const,
        raw: match[0],
        normalized: [document ?? "ANY", `RZ${start}`, end ? `TO${end}` : "", following ? "FF" : ""]
          .filter(Boolean)
          .join(":"),
        start,
        ...(end ? { end } : {}),
        following,
        ...(document ? { document } : {}),
      },
    };
  });
}

function amountYearTokens(text: string): PositionedToken[] {
  return [...text.matchAll(AMOUNT_PATTERN)].flatMap((match) => {
    const groups = match.groups ?? {};
    const rawAmount = groups.amountBefore ?? groups.amountAfter;
    if (!rawAmount) return [];
    const amountCents = normalizeAmountToCents(rawAmount);
    if (amountCents === undefined) return [];
    const year = closestYear(text, match.index, match[0].length);
    return [{
      index: match.index,
      token: {
        kind: "amount_year" as const,
        raw: match[0],
        normalized: `EUR:${amountCents}:${year ?? "NO_YEAR"}`,
        currency: "EUR" as const,
        amountCents,
        ...(year ? { year } : {}),
      },
    }];
  });
}

export function extractFinalReferenceTokens(text: string): FinalReferenceToken[] {
  const positioned = [
    ...exactTokens(text, BFG_GZ_PATTERN, "bfg_gz"),
    ...exactTokens(text, ECLI_PATTERN, "ecli"),
    ...exactTokens(text, CITATION_LABEL_PATTERN, "citation_label"),
    ...paragraphTokens(text),
    ...marginNumberTokens(text),
    ...amountYearTokens(text),
  ].sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  return positioned.flatMap(({ token }) => {
    const key = `${token.kind}:${token.normalized}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [token];
  });
}

function paragraphSupported(
  answer: Extract<FinalReferenceToken, { kind: "paragraph" }>,
  evidence: Extract<FinalReferenceToken, { kind: "paragraph" }>,
): boolean {
  return answer.section === evidence.section
    && (!answer.subsection || answer.subsection === evidence.subsection)
    && (!answer.item || answer.item === evidence.item)
    && (!answer.letter || answer.letter === evidence.letter)
    && (!answer.law || answer.law === evidence.law);
}

function marginNumberSupported(
  answer: Extract<FinalReferenceToken, { kind: "margin_number" }>,
  evidence: Extract<FinalReferenceToken, { kind: "margin_number" }>,
): boolean {
  return answer.start === evidence.start
    && answer.end === evidence.end
    && answer.following === evidence.following
    && (!answer.document || answer.document === evidence.document);
}

function tokenSupported(answer: FinalReferenceToken, evidence: FinalReferenceToken): boolean {
  if (answer.kind !== evidence.kind) return false;
  if (answer.kind === "paragraph" && evidence.kind === "paragraph") {
    return paragraphSupported(answer, evidence);
  }
  if (answer.kind === "margin_number" && evidence.kind === "margin_number") {
    return marginNumberSupported(answer, evidence);
  }
  if (answer.kind === "amount_year" && evidence.kind === "amount_year") {
    return Boolean(answer.year)
      && answer.year === evidence.year
      && answer.amountCents === evidence.amountCents;
  }
  return answer.normalized === evidence.normalized;
}

function evidenceTokens(evidence: InternalEvidenceText): FinalReferenceToken[] {
  const extracted = extractFinalReferenceTokens(evidence.text);
  for (const label of evidence.citationLabels ?? []) {
    const normalized = normalizeCitationLabel(label);
    if (normalized && !extracted.some((token) => (
      token.kind === "citation_label" && token.normalized === normalized
    ))) {
      extracted.push({
        kind: "citation_label",
        raw: label,
        normalized,
      });
    }
  }
  return extracted;
}

/**
 * Purely internal consistency check. It performs no external lookup and only
 * accepts references already present in the supplied evidence texts/metadata.
 */
export function validateFinalAnswerReferences(options: {
  answer: string;
  evidence: readonly InternalEvidenceText[];
}): FinalReferenceValidationResult {
  const answerTokens = extractFinalReferenceTokens(options.answer);
  const evidenceWithTokens = options.evidence.map((entry) => ({
    evidenceId: entry.evidenceId,
    tokens: evidenceTokens(entry),
  }));
  const combinedEvidenceTokens = evidenceWithTokens.flatMap((entry) => entry.tokens);
  const checks = answerTokens.map((token): FinalReferenceCheck => ({
    token,
    supportedByEvidenceIds: evidenceWithTokens
      .filter((entry) => entry.tokens.some((candidate) => tokenSupported(token, candidate)))
      .map((entry) => entry.evidenceId),
  }));
  const unsupportedTokens = checks
    .filter((check) => check.supportedByEvidenceIds.length === 0)
    .map((check) => check.token);

  return {
    supported: unsupportedTokens.length === 0,
    answerTokens,
    evidenceTokens: combinedEvidenceTokens,
    checks,
    unsupportedTokens,
  };
}
