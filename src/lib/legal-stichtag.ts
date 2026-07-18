import { UserVisibleError } from "./errors";

export type StichtagResolution =
  | {
      kind: "explicit";
      stichtag: string;
      matchedText: string;
    }
  | {
      kind: "implicit";
      stichtag: string;
      reason: "current_word" | "default_current";
    }
  | {
      kind: "unknown";
      stichtag: null;
      reason: "ambiguous" | "year_only" | "anaphoric";
      referenceYear?: number;
    };

type DateCandidate = {
  start: number;
  end: number;
  raw: string;
};

const MONTHS = new Map<string, number>([
  ["jänner", 1],
  ["jaenner", 1],
  ["januar", 1],
  ["feber", 2],
  ["februar", 2],
  ["märz", 3],
  ["maerz", 3],
  ["april", 4],
  ["mai", 5],
  ["juni", 6],
  ["juli", 7],
  ["august", 8],
  ["september", 9],
  ["oktober", 10],
  ["november", 11],
  ["dezember", 12],
]);

const MONTH_NAME_SOURCE =
  "jänner|jaenner|januar|feber|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember";

const ANAPHORIC_PATTERN =
  /\b(?:damals|seinerzeit|zu\s+(?:diesem|jenem)\s+zeitpunkt|zu\s+(?:dieser|jener)\s+zeit)\b/iu;
const CURRENT_PATTERN =
  /\b(?:heute|heutig\p{L}*|aktuell\p{L}*|derzeit|zurzeit|gegenwärtig\p{L}*|jetzt|jetzig\p{L}*|momentan)\b/iu;
const CURRENT_LAW_PATTERN =
  /\b(?:geltend\p{L}*|gültig\p{L}*)\s+(?:recht|rechtslage|gesetzeslage|fassung)\b/iu;

const LEGAL_MARKER =
  "stichtag|rechtslage|gesetzeslage|rechtsstand|gesetzesstand|stand|fassung";
const LEGAL_CONNECTOR =
  "zum|am|im|vom|per|mit|auf|nach|für|der|die|das|den|dem|des|jahr(?:es)?|kalenderjahr(?:es)?|ist|war|gilt|galt|gelten|galten|gültig\\p{L}*|geltend\\p{L}*|maßgeblich\\p{L}*|anzuwendend\\p{L}*";
const MARKER_BEFORE_PATTERN = new RegExp(
  `\\b(?:${LEGAL_MARKER})\\b[\\s:;,()=–—-]*(?:(?:${LEGAL_CONNECTOR})\\b[\\s:;,()=–—-]*){0,7}$`,
  "iu",
);
const LEGAL_PREDICATE_BEFORE_PATTERN =
  /\b(?:gilt|galt|gelten|galten|maßgeblich|anzuwenden)\s+(?:am|zum|per)\s*$/iu;
const MARKER_AFTER_PATTERN = new RegExp(
  `^\\s*[,;:()=–—-]*\\s*(?:(?:geltend\\p{L}*|gültig\\p{L}*|maßgeblich\\p{L}*|anzuwendend\\p{L}*)\\s+)+(?:${LEGAL_MARKER}|recht|gesetz|norm)\\b`,
  "iu",
);
const STICHTAG_AFTER_PATTERN = /^\s*[,;:()=–—-]*\s*(?:als\s+)?(?:stichtag|rechtsstand)\b/iu;
const AMOUNT_CONCEPT_PATTERN = /\b(?:[a-zäöüß]*absetzbetrag|[a-zäöüß]*freibetrag|[a-zäöüß]*grenzbetrag|[a-zäöüß]*pauschale|[a-zäöüß]*grenze|pauschbetrag|familienbeihilfe|familienbonus(?:\s+plus)?|haushaltsersparnis|kindermehrbetrag|mehrkindzuschlag|pendlereuro|kilometergeld|taggeld|nächtigungsgeld)\b/iu;

function hasAmountDateContext(question: string, candidate: DateCandidate): boolean {
  const before = question.slice(Math.max(0, candidate.start - 180), candidate.start);
  const after = question.slice(candidate.end, candidate.end + 50);
  const factualDateContext = /(?:\b(?:geboren|geburt|geburtsdatum|geb\.?|bezahlt|zahlung|geheiratet|eheschließung|eingereist|verstorben)|zur\s+welt\s+gekommen)\s*$/iu.test(before)
    || /^\s*(?:(?:geboren(?:e[snm]?)?|geb\.?|bezahlt|geleistet|eingereicht|ausgestellt|verstorben)\b|zur\s+welt\s+gekommen\b)/iu.test(after);
  return /\bam\s*$/iu.test(before)
    && AMOUNT_CONCEPT_PATTERN.test(before)
    && !factualDateContext;
}

function collectDateCandidates(question: string): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  const patterns = [
    /(?<!\d)\d{4}\s*-\s*\d{1,2}\s*-\s*\d{1,2}(?!\d)/gu,
    /(?<!\d)\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{4}(?!\d)/gu,
    new RegExp(`(?<!\\d)\\d{1,2}\\.?\\s+(?:${MONTH_NAME_SOURCE})\\s+\\d{4}(?!\\d)`, "giu"),
  ];

  for (const pattern of patterns) {
    for (const match of question.matchAll(pattern)) {
      const start = match.index;
      const raw = match[0];
      candidates.push({ start, end: start + raw.length, raw });
    }
  }

  return candidates.sort((left, right) => left.start - right.start);
}

function hasLegalDateContext(question: string, candidate: DateCandidate): boolean {
  const before = question.slice(Math.max(0, candidate.start - 120), candidate.start);
  const after = question.slice(candidate.end, candidate.end + 80);

  return (
    MARKER_BEFORE_PATTERN.test(before) ||
    LEGAL_PREDICATE_BEFORE_PATTERN.test(before) ||
    MARKER_AFTER_PATTERN.test(after) ||
    STICHTAG_AFTER_PATTERN.test(after) ||
    hasAmountDateContext(question, candidate)
  );
}

function parseDate(candidate: string): string | null {
  let year: number;
  let month: number;
  let day: number;
  const normalized = candidate.trim().toLocaleLowerCase("de-AT");
  const isoMatch = /^(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})$/u.exec(normalized);
  const numericMatch = /^(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4})$/u.exec(
    normalized,
  );
  const namedMatch = new RegExp(
    `^(\\d{1,2})\\.?\\s+(${MONTH_NAME_SOURCE})\\s+(\\d{4})$`,
    "iu",
  ).exec(normalized);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (numericMatch) {
    day = Number(numericMatch[1]);
    month = Number(numericMatch[2]);
    year = Number(numericMatch[3]);
  } else if (namedMatch) {
    day = Number(namedMatch[1]);
    month = MONTHS.get(namedMatch[2].toLocaleLowerCase("de-AT")) ?? 0;
    year = Number(namedMatch[3]);
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function viennaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function fallsWithin(candidate: DateCandidate, index: number): boolean {
  return index >= candidate.start && index < candidate.end;
}

function collectMarkedReferenceYears(
  question: string,
  dateCandidates: DateCandidate[],
): number[] {
  const years: number[] = [];

  for (const match of question.matchAll(/(?<![\d.-])(?:1[89]\d{2}|2\d{3})(?![\d.-])/gu)) {
    const start = match.index;
    if (dateCandidates.some((candidate) => fallsWithin(candidate, start))) {
      continue;
    }

    const candidate = { start, end: start + match[0].length, raw: match[0] };
    if (hasLegalDateContext(question, candidate)) {
      years.push(Number(match[0]));
    }
  }

  return years;
}

function collectAmountReferenceYears(
  question: string,
  dateCandidates: DateCandidate[],
): number[] {
  if (!AMOUNT_CONCEPT_PATTERN.test(question)) return [];
  const years: number[] = [];
  for (const match of question.matchAll(/(?<![\d.-])(?:1[89]\d{2}|2\d{3})(?![\d.-])/gu)) {
    const start = match.index;
    if (dateCandidates.some((candidate) => fallsWithin(candidate, start))) continue;
    const before = question.slice(Math.max(0, start - 100), start);
    const after = question.slice(start + match[0].length, start + match[0].length + 100);
    const factualYear = /\b(?:geboren|geburtsjahr|verstorben|bezahlt|geleistet|eingereist)\s*$/iu.test(before)
      || /^\s*(?:geboren|verstorben|bezahlt|geleistet|eingereist)\b/iu.test(after);
    const statuteYear = /\b(?:estg|kstg|ustg|flag|famlagausglg|bao|abgb|ugb)\s*$/iu.test(before);
    if (!factualYear && !statuteYear) years.push(Number(match[0]));
  }
  return years;
}

export function isKnownStichtag(
  resolution: StichtagResolution,
): resolution is Exclude<StichtagResolution, { kind: "unknown" }> {
  return resolution.kind !== "unknown";
}

export function resolveLegalStichtag(
  latestQuestion: string,
  now: Date = new Date(),
): StichtagResolution {
  const dateCandidates = collectDateCandidates(latestQuestion);
  const markedCandidates = dateCandidates.filter((candidate) =>
    hasLegalDateContext(latestQuestion, candidate),
  );
  const explicitDates = markedCandidates.map((candidate) => {
    const stichtag = parseDate(candidate.raw);
    if (!stichtag) {
      throw new UserVisibleError("Der angegebene Stichtag ist ungültig.", 400);
    }
    return { candidate, stichtag };
  });
  const referenceYears = Array.from(new Set([
    ...collectMarkedReferenceYears(latestQuestion, dateCandidates),
    ...collectAmountReferenceYears(latestQuestion, dateCandidates),
  ]));

  if (explicitDates.length > 1 || (explicitDates.length > 0 && referenceYears.length > 0)) {
    return { kind: "unknown", stichtag: null, reason: "ambiguous" };
  }

  if (ANAPHORIC_PATTERN.test(latestQuestion)) {
    return { kind: "unknown", stichtag: null, reason: "anaphoric" };
  }

  if (explicitDates.length === 1) {
    const [{ candidate, stichtag }] = explicitDates;
    return { kind: "explicit", stichtag, matchedText: candidate.raw };
  }

  if (referenceYears.length > 1) {
    return { kind: "unknown", stichtag: null, reason: "ambiguous" };
  }
  if (referenceYears.length === 1) {
    return {
      kind: "unknown",
      stichtag: null,
      reason: "year_only",
      referenceYear: referenceYears[0],
    };
  }

  const stichtag = viennaDate(now);
  if (CURRENT_PATTERN.test(latestQuestion) || CURRENT_LAW_PATTERN.test(latestQuestion)) {
    return { kind: "implicit", stichtag, reason: "current_word" };
  }

  return { kind: "implicit", stichtag, reason: "default_current" };
}
