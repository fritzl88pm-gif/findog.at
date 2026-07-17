import {
  RESEARCH_SOURCE_NAMES,
  type ResearchSourceKey,
} from "./research-source-display";

export type ResearchPlanMode =
  | "no_research"
  | "simple_amount"
  | "general"
  | "clarification_required";

export type ResearchQuestionDomain = "legal" | "internal" | "mixed";

export type ResearchScope =
  | "smalltalk"
  | "out_of_scope"
  | "legal"
  | "internal"
  | "uncertain";

export interface ResearchScopeDecision {
  scope: ResearchScope;
  reason: string;
}

export type ResearchPhaseKind =
  | "amount_lookup"
  | "primary_law"
  | "primary_internal"
  | "bfg_case_law"
  | "supplementary_sources";

export type EvidenceReadPolicy = "full_entry_required" | "full_text_required";

export interface ResearchPlanPhase {
  id: string;
  order: number;
  kind: ResearchPhaseKind;
  required: boolean;
  sourceKeys: readonly ResearchSourceKey[];
  query: string;
  dependsOn: readonly string[];
  evidenceReadPolicy: EvidenceReadPolicy;
}

export interface ResearchPlanInput {
  /** Complete, context-resolved question; never pass a fragment such as "und 2024?". */
  question: string;
  /** Explicitly injected legal reference date. No current-year fallback is performed. */
  stichtag: string;
  /** Explicit caller-side scope override after a trusted routing decision. */
  scope?: ResearchScope;
  domain?: ResearchQuestionDomain;
  /** Conservative override when the question needs subsumption or calculation. */
  requiresLegalAssessment?: boolean;
  /** A caller-side relevance decision; it must not be inferred from a keyword hit. */
  bfgMateriallyRelevant?: boolean;
  /** Explicit user intent can also be supplied when it came from conversation context. */
  bfgExplicitlyRequested?: boolean;
  /** Sources determined relevant upstream. They remain supplementary to primary law. */
  supplementalSources?: readonly ResearchSourceKey[];
}

export interface ResearchPlanClassification {
  mode: ResearchPlanMode;
  scope: ResearchScope;
  referenceYears: readonly string[];
  explicitBfgRequest: boolean;
  reason: string;
}

export interface ValidatedResearchPlan {
  mode: ResearchPlanMode;
  scope: ResearchScope;
  question: string;
  stichtag: string;
  domain: ResearchQuestionDomain | null;
  referenceYears: readonly string[];
  bfg: {
    explicitlyRequested: boolean;
    materiallyRelevant: boolean;
    included: boolean;
  };
  phases: readonly ResearchPlanPhase[];
  clarificationReason?: string;
}

export interface ResearchPlanValidationIssue {
  code:
    | "invalid_stichtag"
    | "missing_primary_source"
    | "invalid_simple_amount_plan"
    | "unjustified_bfg_phase"
    | "duplicate_phase_id"
    | "invalid_phase_order"
    | "invalid_dependency"
    | "invalid_source_phase"
    | "missing_full_text_policy"
    | "invalid_scope_plan";
  message: string;
}

export interface ResearchPlanValidation {
  valid: boolean;
  issues: readonly ResearchPlanValidationIssue[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/gu;
const AMOUNT_QUESTION_PATTERN = /(?:\bwie\s+hoch\b|\bwelche[rsn]?\s+betrag\b|\bhöhe\b|\bbetrag\b)/iu;
const AMOUNT_CONCEPT_PATTERN = /(?:\bAVAB\b|\bAEAB\b|\bUAB\b|absetzbetrag|freibetrag|grenzbetrag|höchstbetrag|pauschbetrag|pendlerpauschale|familienbonus|kilometergeld)/iu;
const LEGAL_ASSESSMENT_PATTERN = /(?:\bvoraussetzungen?\b|\banspruch\b|\bgilt\b|\bkann\b|\bdarf\b|\bwarum\b|\bsteuerlich\b|\brechtlich\b|\bberechn(?:e|en|ung)\b|\bsubsum|§|\bmein(?:e|er|em|en)?\b|\bfür\s+mich\b|\beinkommen\s+von\b)/iu;
const EXPLICIT_BFG_PATTERN = /(?:\bBFG\b|Bundesfinanzgericht|\b(?:RV|RS|RM|AW|VH)\/[0-9A-Z-]+\/\d{4}\b)/iu;
const SMALLTALK_SCOPE_PATTERN = /^(?:(?:hallo|hi|servus|gruss gott|guten (?:morgen|tag|abend))(?: (?:fred|findog))?|(?:danke|vielen dank|besten dank|passt|okay|ok|tschuss|auf wiedersehen)|(?:wer bist du|was kannst du|wie geht es dir))\s*[!.,?]*$/iu;
const PRODUCT_SUPPORT_SCOPE_PATTERN = /(?:\bfindog(?:\.at)?\b|\bchatbox\b|\bmodellauswahl\b|\bmodell auswahlen\b|\bpasswort andern\b|\b(?:account|konto) loschen\b|\b(?:bild|pdf|datei|anhang) (?:hochladen|anhangen|einfugen)\b|\bstrg\s*\+\s*v\b)/iu;
const OUT_OF_SCOPE_PATTERN = /\b(?:wetter|wetterbericht|temperatur|hauptstadt|fussball|rezept|kochen|backen|ubersetzen|ubersetzung|songtext|kino|urlaubsziel|programmiersprache)\b/iu;
const INTERNAL_SCOPE_PATTERN = /(?:\borganisationshandbuch\b|\bohb\b|\bgeschaftsverteilung\b|\bdienststelle\b|\bdienststellenzustandigkeit\b|\baktenart\b|\bschalterdienst\b|\bcc\s*scan\b|\binterne? organisation\b|\bintern\b.{0,60}\bzustandig\b|\bzustandig\b.{0,60}\bintern\b)/iu;
const LEGAL_SCOPE_PATTERN = /(?:§|\b(?:steuer|steuern|steuerlich|abgabe|abgabenrecht|einkommensteuer|lohnsteuer|umsatzsteuer|korperschaftsteuer|werbungskosten|sonderausgaben|aussergewohnliche belastungen|betriebsausgaben|einkunfte|absetzbetrag|freibetrag|familienbonus|familienbeihilfe|pendlerpauschale|kilometergeld|estg|ustg|kstg|bao|flag|lstr|estr|dba|bescheid|beschwerde|veranlagung|arbeitnehmerveranlagung|bfg|bundesfinanzgericht|avab|aeab|uab|geltend machen|absetzen)\b)/iu;
const SOURCE_KEYS = Object.keys(RESEARCH_SOURCE_NAMES) as ResearchSourceKey[];
const SOURCE_KEY_SET = new Set<ResearchSourceKey>(SOURCE_KEYS);
const SUPPLEMENTARY_SOURCE_SET = new Set<ResearchSourceKey>([
  "FEXKLUSIV",
  "WIN_ANV",
  "ARBEITSBEHELFE",
  "BETRAGSTABELLE",
  "WIKI",
]);

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day;
}

function normalizedQuestion(question: string): string {
  const normalized = question.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    throw new TypeError("question must not be empty.");
  }
  return normalized;
}

function normalizedScopeText(question: string): string {
  return normalizedQuestion(question)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("de-AT");
}

export function classifyResearchScope(question: string): ResearchScopeDecision {
  const normalized = normalizedScopeText(question);
  if (SMALLTALK_SCOPE_PATTERN.test(normalized)) {
    return {
      scope: "smalltalk",
      reason: "Reine Begrüßung oder Unterhaltung ohne fachlichen Recherchebedarf.",
    };
  }

  const hasLegalSignal = LEGAL_SCOPE_PATTERN.test(normalized)
    || AMOUNT_CONCEPT_PATTERN.test(question)
    || EXPLICIT_BFG_PATTERN.test(question);
  const hasInternalSignal = INTERNAL_SCOPE_PATTERN.test(normalized);
  if (PRODUCT_SUPPORT_SCOPE_PATTERN.test(normalized) && !hasLegalSignal && !hasInternalSignal) {
    return {
      scope: "out_of_scope",
      reason: "Produktbedienung ist keine Rechts- oder interne Fachrecherche.",
    };
  }
  if (hasLegalSignal) {
    return {
      scope: "legal",
      reason: hasInternalSignal
        ? "Die Frage enthält einen rechtlichen und einen internen Fachbezug."
        : "Die Frage enthält einen hinreichend eindeutigen steuer- oder abgabenrechtlichen Fachbezug.",
    };
  }
  if (hasInternalSignal) {
    return {
      scope: "internal",
      reason: "Die Frage betrifft die interne Organisation oder Zuständigkeit.",
    };
  }
  if (OUT_OF_SCOPE_PATTERN.test(normalized)) {
    return {
      scope: "out_of_scope",
      reason: "Die Frage ist erkennbar allgemeines Wissen ohne Findog-Fachbezug.",
    };
  }
  return {
    scope: "uncertain",
    reason: "Ein steuerrechtlicher oder interner Fachbezug ist nicht verlässlich erkennbar.",
  };
}

function scopeDecision(input: ResearchPlanInput, question: string): ResearchScopeDecision {
  return input.scope
    ? { scope: input.scope, reason: "Der Fachbereich wurde vom Aufrufer ausdrücklich festgelegt." }
    : classifyResearchScope(question);
}

function domainForScope(
  scope: ResearchScope,
  question: string,
  requestedDomain?: ResearchQuestionDomain,
): ResearchQuestionDomain | null {
  if (scope === "internal") return "internal";
  if (scope !== "legal") return null;
  if (requestedDomain === "mixed" || INTERNAL_SCOPE_PATTERN.test(normalizedScopeText(question))) {
    return "mixed";
  }
  return "legal";
}

export function extractReferenceYears(question: string): string[] {
  return [...new Set(question.match(YEAR_PATTERN) ?? [])];
}

export function classifyResearchPlanInput(
  input: ResearchPlanInput,
): ResearchPlanClassification {
  const question = normalizedQuestion(input.question);
  const scope = scopeDecision(input, question);
  const referenceYears = extractReferenceYears(question);
  const explicitBfgRequest = Boolean(input.bfgExplicitlyRequested)
    || EXPLICIT_BFG_PATTERN.test(question);
  const amountIntent = AMOUNT_QUESTION_PATTERN.test(question)
    && AMOUNT_CONCEPT_PATTERN.test(question);
  const needsAssessment = Boolean(input.requiresLegalAssessment)
    || LEGAL_ASSESSMENT_PATTERN.test(question);

  if (scope.scope === "smalltalk" || scope.scope === "out_of_scope") {
    return {
      mode: "no_research",
      scope: scope.scope,
      referenceYears,
      explicitBfgRequest: false,
      reason: scope.reason,
    };
  }

  if (scope.scope === "uncertain") {
    return {
      mode: "clarification_required",
      scope: scope.scope,
      referenceYears,
      explicitBfgRequest: false,
      reason: scope.reason,
    };
  }

  if (scope.scope === "legal" && amountIntent && !needsAssessment && referenceYears.length === 0) {
    return {
      mode: "clarification_required",
      scope: scope.scope,
      referenceYears,
      explicitBfgRequest,
      reason: "Eine reine jahresabhängige Betragsfrage benötigt ein ausdrücklich genanntes Jahr.",
    };
  }

  if (
    scope.scope === "legal"
    && amountIntent
    && !needsAssessment
    && referenceYears.length === 1
    && !explicitBfgRequest
  ) {
    return {
      mode: "simple_amount",
      scope: scope.scope,
      referenceYears,
      explicitBfgRequest,
      reason: "Reine Betragsfrage mit genau einem ausdrücklich genannten Jahr.",
    };
  }

  return {
    mode: "general",
    scope: scope.scope,
    referenceYears,
    explicitBfgRequest,
    reason: needsAssessment
      ? "Die Frage erfordert rechtliche Würdigung oder Berechnung."
      : "Die Anfrage erfüllt die engen Voraussetzungen des Betrags-Kurzpfads nicht.",
  };
}

function uniqueSupplementalSources(
  sources: readonly ResearchSourceKey[],
): ResearchSourceKey[] {
  const unique: ResearchSourceKey[] = [];
  const seen = new Set<ResearchSourceKey>();
  for (const source of sources) {
    if (!SOURCE_KEY_SET.has(source)) {
      throw new TypeError(`Unknown research source: ${String(source)}`);
    }
    if (SUPPLEMENTARY_SOURCE_SET.has(source) && !seen.has(source)) {
      unique.push(source);
      seen.add(source);
    }
  }
  return unique;
}

function phase(
  id: string,
  order: number,
  kind: ResearchPhaseKind,
  required: boolean,
  sourceKeys: readonly ResearchSourceKey[],
  query: string,
  dependsOn: readonly string[],
  evidenceReadPolicy: EvidenceReadPolicy,
): ResearchPlanPhase {
  return {
    id,
    order,
    kind,
    required,
    sourceKeys,
    query,
    dependsOn,
    evidenceReadPolicy,
  };
}

export function buildValidatedResearchPlan(input: ResearchPlanInput): ValidatedResearchPlan {
  const question = normalizedQuestion(input.question);
  if (!isValidIsoDate(input.stichtag)) {
    throw new TypeError("stichtag must be a valid ISO date (YYYY-MM-DD).");
  }

  const classification = classifyResearchPlanInput({ ...input, question });
  const domain = domainForScope(classification.scope, question, input.domain);
  const bfgMateriallyRelevant = Boolean(input.bfgMateriallyRelevant);
  const includeBfg = classification.mode === "general"
    && classification.scope === "legal"
    && (classification.explicitBfgRequest || bfgMateriallyRelevant);
  const planPhases: ResearchPlanPhase[] = [];

  if (classification.mode === "no_research" || classification.mode === "clarification_required") {
    const plan: ValidatedResearchPlan = {
      mode: classification.mode,
      scope: classification.scope,
      question,
      stichtag: input.stichtag,
      domain,
      referenceYears: classification.referenceYears,
      bfg: {
        explicitlyRequested: classification.explicitBfgRequest,
        materiallyRelevant: bfgMateriallyRelevant,
        included: false,
      },
      phases: [],
      clarificationReason: classification.reason,
    };
    assertValidResearchPlan(plan);
    return plan;
  }

  if (domain === null) {
    throw new TypeError("A research plan requires a resolved legal or internal domain.");
  }

  if (classification.mode === "simple_amount") {
    const referenceYear = classification.referenceYears[0];
    planPhases.push(phase(
      `amount-${referenceYear}`,
      0,
      "amount_lookup",
      true,
      ["BETRAGSTABELLE"],
      question,
      [],
      "full_entry_required",
    ));
  } else {
    if (domain === "legal" || domain === "mixed") {
      planPhases.push(phase(
        "primary-law",
        planPhases.length,
        "primary_law",
        true,
        ["GESETZE"],
        question,
        [],
        "full_text_required",
      ));
    } else {
      planPhases.push(phase(
        "primary-internal",
        planPhases.length,
        "primary_internal",
        true,
        ["ARBEITSBEHELFE"],
        question,
        [],
        "full_text_required",
      ));
    }

    if (includeBfg) {
      planPhases.push(phase(
        "bfg-case-law",
        planPhases.length,
        "bfg_case_law",
        classification.explicitBfgRequest,
        ["BFG"],
        question,
        [planPhases[0]!.id],
        "full_text_required",
      ));
    }

    const requestedSupplemental = uniqueSupplementalSources(input.supplementalSources ?? []);
    if (domain === "mixed" && !requestedSupplemental.includes("ARBEITSBEHELFE")) {
      requestedSupplemental.push("ARBEITSBEHELFE");
    }
    const primarySource = planPhases[0]?.sourceKeys[0];
    const supplementalSources = requestedSupplemental.filter((source) => source !== primarySource);
    if (supplementalSources.length > 0) {
      planPhases.push(phase(
        "supplementary-sources",
        planPhases.length,
        "supplementary_sources",
        false,
        supplementalSources,
        question,
        planPhases.map((item) => item.id),
        supplementalSources.every((source) => (
          source === "WIN_ANV" || source === "BETRAGSTABELLE"
        ))
          ? "full_entry_required"
          : "full_text_required",
      ));
    }
  }

  const plan: ValidatedResearchPlan = {
    mode: classification.mode,
    scope: classification.scope,
    question,
    stichtag: classification.mode === "simple_amount"
      ? `${classification.referenceYears[0]}-12-31`
      : input.stichtag,
    domain,
    referenceYears: classification.referenceYears,
    bfg: {
      explicitlyRequested: classification.explicitBfgRequest,
      materiallyRelevant: bfgMateriallyRelevant,
      included: includeBfg,
    },
    phases: planPhases,
  };
  assertValidResearchPlan(plan);
  return plan;
}

export function validateResearchPlan(plan: ValidatedResearchPlan): ResearchPlanValidation {
  const issues: ResearchPlanValidationIssue[] = [];
  if (!isValidIsoDate(plan.stichtag)) {
    issues.push({ code: "invalid_stichtag", message: "The plan has no valid ISO stichtag." });
  }

  const phaseIds = new Set<string>();
  for (const [index, item] of plan.phases.entries()) {
    if (phaseIds.has(item.id)) {
      issues.push({ code: "duplicate_phase_id", message: `Duplicate phase id: ${item.id}` });
    }
    phaseIds.add(item.id);
    if (item.order !== index) {
      issues.push({ code: "invalid_phase_order", message: `Invalid order for phase ${item.id}.` });
    }
    if (!item.evidenceReadPolicy) {
      issues.push({
        code: "missing_full_text_policy",
        message: `Phase ${item.id} has no evidence read policy.`,
      });
    }
    for (const source of item.sourceKeys) {
      if (!SOURCE_KEY_SET.has(source)) {
        issues.push({
          code: "invalid_source_phase",
          message: `Phase ${item.id} contains an unknown source.`,
        });
      }
    }
    for (const dependency of item.dependsOn) {
      const dependencyPhase = plan.phases.find((candidate) => candidate.id === dependency);
      if (!dependencyPhase || dependencyPhase.order >= item.order) {
        issues.push({
          code: "invalid_dependency",
          message: `Phase ${item.id} has an invalid dependency: ${dependency}.`,
        });
      }
    }
  }

  if (plan.mode === "no_research") {
    const validNoResearchPlan = (
      plan.scope === "smalltalk" || plan.scope === "out_of_scope"
    )
      && plan.domain === null
      && plan.phases.length === 0
      && !plan.bfg.included;
    if (!validNoResearchPlan) {
      issues.push({
        code: "invalid_scope_plan",
        message: "A no-research plan must have a non-specialist scope and no research phases.",
      });
    }
  } else if (plan.mode === "clarification_required") {
    if (plan.phases.length > 0 || !plan.clarificationReason) {
      issues.push({
        code: "invalid_simple_amount_plan",
        message: "A clarification plan must not schedule retrieval.",
      });
    }
    const validClarificationScope = plan.scope === "uncertain"
      ? plan.domain === null
      : plan.scope === "legal" && plan.domain === "legal";
    if (!validClarificationScope) {
      issues.push({
        code: "invalid_scope_plan",
        message: "A clarification plan must be an unresolved scope or an incomplete legal amount request.",
      });
    }
  } else if (plan.mode === "simple_amount") {
    const validAmountPlan = plan.referenceYears.length === 1
      && plan.scope === "legal"
      && plan.domain === "legal"
      && plan.phases.length === 1
      && plan.phases[0]?.kind === "amount_lookup"
      && plan.phases[0]?.sourceKeys.length === 1
      && plan.phases[0]?.sourceKeys[0] === "BETRAGSTABELLE"
      && plan.phases[0]?.evidenceReadPolicy === "full_entry_required"
      && !plan.bfg.included;
    if (!validAmountPlan) {
      issues.push({
        code: "invalid_simple_amount_plan",
        message: "A simple amount plan may only read the complete amount-table entry for one year.",
      });
    }
  } else {
    const firstPhase = plan.phases[0];
    const validScopeDomain = plan.scope === "internal"
      ? plan.domain === "internal"
      : plan.scope === "legal" && (plan.domain === "legal" || plan.domain === "mixed");
    if (!validScopeDomain) {
      issues.push({
        code: "invalid_scope_plan",
        message: "A general research plan requires a matching legal or internal scope and domain.",
      });
    }
    const validPrimary = plan.scope === "internal"
      ? firstPhase?.kind === "primary_internal"
        && firstPhase.sourceKeys.includes("ARBEITSBEHELFE")
      : firstPhase?.kind === "primary_law" && firstPhase.sourceKeys.includes("GESETZE");
    if (!validPrimary) {
      issues.push({
        code: "missing_primary_source",
        message: "A general plan must start with its deterministic primary source.",
      });
    }
  }

  const bfgPhase = plan.phases.find((item) => item.kind === "bfg_case_law");
  if (bfgPhase && !(plan.bfg.explicitlyRequested || plan.bfg.materiallyRelevant)) {
    issues.push({
      code: "unjustified_bfg_phase",
      message: "BFG may only be scheduled when explicitly requested or materially relevant.",
    });
  }
  if (Boolean(bfgPhase) !== plan.bfg.included) {
    issues.push({
      code: "unjustified_bfg_phase",
      message: "BFG plan metadata and phases disagree.",
    });
  }

  return { valid: issues.length === 0, issues };
}

export function assertValidResearchPlan(plan: ValidatedResearchPlan): void {
  const validation = validateResearchPlan(plan);
  if (!validation.valid) {
    throw new TypeError(validation.issues.map((issue) => issue.message).join(" "));
  }
}
