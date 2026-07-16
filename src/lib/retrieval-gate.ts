/**
 * Deterministic entry gate for the legal-research workflow.
 *
 * Only user turns are topic authority. Assistant answers may contain
 * unsupported statements and must not silently become a retrieval query for a
 * later turn.
 */

export type RetrievalConversationMessage = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

export type RetrievalQuestionKind = "fachfrage" | "non_fachfrage";
export type RetrievalGatePhase =
  | "law_search_required"
  | "law_search_completed"
  | "ready_to_finalize";

export type RetrievalClassificationReason =
  | "direct_domain_signal"
  | "default_domain_scope"
  | "contextual_follow_up"
  | "attachment_context"
  | "non_fachfrage";

export type RequiredRetrievalToolName =
  | "search_laws"
  | "search_bfg"
  | "search_win_anv"
  | "search_fexklusiv"
  | "search_work_aids";

export type RetrievalGateOptions = Readonly<{
  forceFachfrage?: boolean;
  /** A bounded, extracted attachment summary used only to improve the query. */
  supplementalSearchContext?: string;
}>;

export type RetrievalGateState = Readonly<{
  kind: RetrievalQuestionKind;
  phase: RetrievalGatePhase;
  classificationReason: RetrievalClassificationReason;
  latestQuestion: string;
  /** The complete, context-resolved query used by every mandatory search. */
  searchQuery: string;
  /** User turns included in searchQuery, in conversation order. */
  contextQuestions: readonly string[];
  /** Mandatory tools in their deterministic execution order. */
  requiredTools: readonly RequiredRetrievalToolName[];
  /** Successfully completed mandatory tools, in execution order. */
  completedTools: readonly RequiredRetrievalToolName[];
  lawSearchAttempts: number;
}>;

export type RetrievalGateDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
    allowed: false;
    code:
      | "law_search_must_run_first"
      | "required_retrieval_step_pending"
      | "law_search_not_completed"
      | "required_retrieval_steps_not_completed";
    message: string;
  }>;

export type RequiredRetrievalAction = Readonly<{
  toolName: RequiredRetrievalToolName;
  arguments: Readonly<{ query: string }>;
}>;

export type RetrievalToolResult = Readonly<{
  toolName: string;
  success: boolean;
}>;

export const REQUIRED_FIRST_RETRIEVAL_TOOL = "search_laws" as const;

const MAX_CONTEXT_USER_TURNS = 4;

const DOMAIN_SIGNAL_PATTERN = /(?:§|\b(?:[a-z]*absetzbetrag(?:e|en)?|[a-z]*freibetrag(?:e|en)?|abgabe(?:n)?|abgabenrecht|abschreibung|absetzbar|absetzen|alleinerzieherabsetzbetrag|alleinverdienerabsetzbetrag|arbeitnehmerveranlagung|arbeitsbehelf(?:e|en)?|arbeitszimmer|aussetzung\s+der\s+einhebung|aussergewohnliche\s+belastung(?:en)?|bao|bescheid|beschwerde(?:fuhrer)?|betriebsausgabe(?:n)?|bfg|bundesabgabenordnung|bundesfinanzgericht|dienstgeber|dienstnehmer|doppelte\s+haushaltsfuhrung|einkommensteuer(?:gesetz)?|estg|fao|familienbeihilfe|familienbonus|fexklusiv|finanzamt|finanzstrafrecht|finstrg|flag|geltend\s+machen|grenzbetrag|homeoffice|interne\s+(?:verwaltungs)?praxis|kest|kilometergeld|korperschaftsteuer(?:gesetz)?|kstg|lohnsteuer(?:richtlinien)?|lstr|mehrkindzuschlag|pendlerpauschale|pendlereuro|pflichtveranlagung|rechtslage|rechtsprechung|richtlinie(?:n)?|sonderausgabe(?:n)?|steuer|steuerfrei|steuerlich|steuergesetz|steuerpflicht|taggeld|umsatzsteuer(?:gesetz)?|ustg|vab|avab|aeab|uab|veranlagung|versteuern|vorsteuer|vwgh|werbungskosten?|win[\s-]?anv|wk|wks)\b)/u;

const ADDITIONAL_DOMAIN_SIGNAL_PATTERN = /\b(?:abzieh(?:en|bar)|abzugsfahig(?:e|en|er|es)?|ansassigkeit|bemessungsgrundlage|betriebsstatte|cc\s*scan|dba|dienststellenzustandigkeit|doppelbesteuerung|einkunft(?:e|en)?|fahrtenbuch(?:er)?|finanzonline|geschaftsverteilung|grenzganger|grundstuck(?:sverkauf|sverausserung)?|interne\s+organisation|kinderbetreuungskosten?|kundenservice|liebhaberei|lohnzettel|meldepflicht(?:ig(?:e|en|er|es)?)?|ohb|organisationsfrage|organisationshandbuch|progressionsvorbehalt|rechtsmittel|sachbezug(?:e|en)?|schenkung(?:en)?|schalterdienst|selbstbehalt(?:e|en)?|steuererklarung(?:en)?|verlust(?:ausgleich|vortrag|verrechnung)|verjahrung(?:sfrist)?|vorhalt(?:e|en)?|werbungskosten[a-z]*|wegzug|zufluss[-\s]*abfluss(?:prinzip)?|zustellung(?:en)?)\b/u;

const PRODUCTIVE_FACH_COMPOUND_PATTERN = /\b[a-z0-9ß][a-z0-9ß-]{1,}(?:steuer(?:n)?|besteuerung(?:en)?|abgabe(?:n)?|kosten|betrag(?:e|en|s)?|pflicht(?:en|ig(?:e|en|er|es)?)?|bescheid(?:e|en|es)?|verfahren(?:s)?|frist(?:en)?|veranlagung(?:en)?|freibetrag(?:e|en|s)?|pauschale(?:n)?|abzug(?:e|en|s)?|richtlinie(?:n)?|verordnung(?:en)?|gesetz(?:e|en|es)?|haftung(?:en)?)\b/u;

const TAX_LEGAL_PREDICATE_PATTERN = /\b(?:abfuhren|abgefuhrt|absetzen|abzieh(?:en|bar)|abzugsfahig|anrechnen|angerechnet|entrichten|festsetzen|festgesetzt|geltend\s+machen|nachversteuern|veranlagen|versteuern|vorschreiben|vorgeschrieben)\b/u;

const COMPLIANCE_DOCUMENT_PATTERN = /\b(?:beleg(?:e|en)?|nachweis(?:e|en)?|unterlage(?:n)?)\b/u;
const COMPLIANCE_ACTION_PATTERN = /\b(?:auf(?:zu)?bewahr(?:en|t|te|ten|ung)?|ein(?:zu)?reich(?:en|t|ung)?|erbring(?:en|t|ung)?|nach(?:zu)?reich(?:en|t|ung)?|vor(?:ge|zu)?leg(?:en|t|te|ten|ung)?)\b/u;
const FORMAL_COMPLIANCE_OBJECT_PATTERN = /\b(?:antrag(?:e|en|s)?|beleg(?:e|en)?|erklarung(?:en)?|formular(?:e|en|s)?|meldung(?:en)?|nachweis(?:e|en)?|unterlage(?:n)?)\b/u;
const FORMAL_COMPLIANCE_ACTION_PATTERN = /\b(?:auf(?:zu)?bewahr(?:en|t|te|ten)?|beantrag(?:en|t|te|ten)?|ein(?:zu)?reich(?:en|t|te|ten)?|meld(?:en|et|ete|eten)?|nach(?:zu)?reich(?:en|t|te|ten)?|vor(?:ge|zu)?leg(?:en|t|te|ten)?)\b/u;
const LEGAL_CONTEXT_NOUN_PATTERN = /\b(?:fallkonstellation(?:en)?|sachverhalt(?:e|en)?)\b/u;

const NON_FACH_STANDALONE_PATTERN = /^(?:hallo|hi|hey|servus|guten\s+(?:morgen|tag|abend)|danke(?:\s+(?:dir|sehr|vielmals))?|vielen\s+dank|passt|okay|ok|verstanden|super|tschuss|auf\s+wiedersehen)[!.?\s]*$/u;

const PRODUCT_META_PATTERN = /(?:\b(?:systemprompt|fredrun|mcp|standardmodell)\b|\bwie\s+funktioniert\b[\s\S]{0,80}\b(?:agent|chat|modell|plattform|app|webseite|datenbank)\b|\b(?:warum|wieso|weshalb|wie)\b[\s\S]{0,80}\b(?:agent|chat|modell|plattform|app|webseite|datenbank)\b|\b(?:agent|chat|modell|plattform|app|webseite|datenbank)\b[\s\S]{0,80}\b(?:funktioniert|zeigt|liefert|sucht|findet|suche|recherche|treffer|antwort|ausgabe|angezeigt|andern|bearbeiten|aktivieren|deaktivieren|konfigurieren)\b)/u;

const PROMPT_META_PATTERN = /\bprompt(?:s|ing|engineering)?\b/u;

const GENERIC_META_PATTERN = /(?:\b(?:warum|wieso|weshalb|wie)\b[\s\S]{0,80}\b(?:suche|recherche|treffer|antwort|ausgabe|angezeigt|gefunden|liefert)\b|\b(?:suche|recherche|treffer|antwort|ausgabe)\b[\s\S]{0,80}\b(?:funktioniert|angezeigt|fehlt|fehlen|begrenzt|entfernt)\b)/u;

const CLEAR_NON_FACH_TOPIC_PATTERN = /(?:\b(?:wetter(?:bericht|vorhersage)?|hauptstadt|witz(?:e)?|rezept(?:e)?|quantenphysik|uhrzeit|gedicht(?:e)?|ubersetz(?:e|en|ung)|e-?mail)\b|\bwie\s+(?:spat|viel\s+uhr)\s+ist\s+es\b)/u;

const GENERAL_EXPLANATION_INTENT_PATTERN = /^(?:(?:bitte\s+)?(?:beschreib(?:e|en)?|erklar(?:e|en)?)(?:\s+mir)?\b|was\s+(?:ist|sind)\b|wie\s+(?:entsteht|funktioniert)\b)/u;

const CLEAR_GENERAL_KNOWLEDGE_TOPIC_PATTERN = /\b(?:astronomie|atom(?:e)?|biologie|chemie|demokratie|evolution|faust|geografie|geschichte|gravitation|internet|kunst|literatur|mathematik|motor|musik|molekul(?:e)?|naturwissenschaft(?:en)?|photosynthese|physik|planet(?:en)?|plattentektonik|quantenphysik|relativitatstheorie|sonnensystem|zellatmung)\b/u;

const AUTHORSHIP_INTENT_PATTERN = /^wer\s+(?:entdeckte|erfand|komponierte|malte|schrieb|verfasste)\b/u;

const GENERAL_TASK_INTENT_PATTERN = /(?:^(?:bitte\s+)?(?:dicht(?:e|en)?|schreib(?:e|en)?|verfass(?:e|en)?)\b|^(?:bitte\s+)?ubersetz(?:e|en)?\b|^(?:bitte\s+)?(?:gib|nenn|erstelle)[\s\S]{0,80}\brezept\b|^wie\s+(?:backe|koche|bereite)\b)/u;

const CONTEXTUAL_FOLLOW_UP_PATTERN = /(?:^\s*(?:und|aber|auch|dann|davon|dafur|dazu|damit|dort|hier|weiterhin|noch|stattdessen)\b|^\s*(?:gilt|gelten|trifft|betrifft|war|ist|sind|ware|waren)\s+(?:das|dies|dieses|es)\b|^\s*(?:wie\s+sieht\s+es|was\s+ist\s+(?:das|dies|damit|dabei)|was\s+gilt\s+(?:dafur|dazu|dabei|dort)|welche\s+voraussetzungen\b[\s\S]{0,80}\b(?:dafur|dazu|dabei))|\b(?:dafur|dazu|damit|dabei|in\s+diesem\s+fall)\b|^\s*(?:fur|im|zum|ab|bis)\s+(?:19|20)\d{2}\b|^\s*(?:19|20)\d{2}\s*[?!.]*\s*$)/u;

const CONTEXT_FREE_FRAGMENT_PATTERN = /^(?:(?:und|aber|auch|dann|davon|dafur|dazu|damit|dort|hier|weiterhin|noch|stattdessen)\b|(?:gilt|gelten|trifft|betrifft|war|ist|sind|ware|waren)\s+(?:das|dies|dieses|es)\b|(?:was\s+ist\s+(?:das|dies|damit|dabei)|was\s+gilt\s+(?:dafur|dazu|dabei|dort))\b|(?:fur|im|zum|ab|bis)\s+(?:19|20)\d{2}\b|(?:19|20)\d{2}\s*[?!.]*$)/u;

const CONTEXT_DEPENDENT_QUESTION_PATTERN = /^(?:(?:warum|wieso|weshalb)|welche\s+voraussetzungen(?:\s+(?:gelten|sind\s+erforderlich))?|was\s+bedeutet\s+(?:das|dies|dieses|es)(?:\s+konkret)?)\s*[?!.]*\s*$/u;

const BFG_SOURCE_PATTERN = /\b(?:bfg|bundesfinanzgericht)\b/u;
const OTHER_COURT_SOURCE_PATTERN = /\b(?:vwgh|vfgh|eugh|verwaltungsgerichtshof|verfassungsgerichtshof|europaischer\s+gerichtshof)\b/u;
const GENERIC_CASE_LAW_REQUEST_PATTERN = /(?:\b(?:welche|einschlagige|gibt\s+es(?:\s+eine)?)\b[\s\S]{0,80}\b(?:rechtsprechung|judikatur|entscheidung|prazedenzfall)\b|\bwie\s+wurde\b[\s\S]{0,80}\bentschieden\b)/u;
const INTERNAL_PRACTICE_SOURCE_PATTERN = /\b(?:win[\s-]?anv|fexklusiv|interne\s+(?:verwaltungspraxis|praxis))\b/u;
const WORK_AIDS_SOURCE_PATTERN = /\b(?:arbeitsbehelf(?:e|en)?|interne\s+dokumente)\b/u;
const INTERNAL_ORGANIZATION_PATTERN = /\b(?:ohb|organisationshandbuch|geschaftsverteilung|dienststellenzustandigkeit|kundenservice|schalterdienst|cc\s*scan|organisationsfrage|interne\s+organisation)\b/u;
const LEGAL_SUBSTANCE_PATTERN = /(?:§|\b(?:steuer|steuerrecht|abgabe(?:n)?|gesetz|verordnung|richtlinie(?:n)?|bescheid|beschwerde|bfg|vwgh|vfgh|eugh|rechtsprechung|judikatur|werbungskosten?|betriebsausgabe(?:n)?|absetzbetrag|freibetrag|estg|ustg|kstg|bao|flag)\b)/u;

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-AT")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDomainSignal(question: string): boolean {
  const normalized = normalizeText(question);
  return DOMAIN_SIGNAL_PATTERN.test(normalized)
    || ADDITIONAL_DOMAIN_SIGNAL_PATTERN.test(normalized);
}

function hasConservativeDomainScopeSignal(question: string): boolean {
  const normalized = normalizeText(question);
  return TAX_LEGAL_PREDICATE_PATTERN.test(normalized)
    || PRODUCTIVE_FACH_COMPOUND_PATTERN.test(normalized)
    || LEGAL_CONTEXT_NOUN_PATTERN.test(normalized)
    || COMPLIANCE_DOCUMENT_PATTERN.test(normalized)
      && COMPLIANCE_ACTION_PATTERN.test(normalized)
    || FORMAL_COMPLIANCE_OBJECT_PATTERN.test(normalized)
      && FORMAL_COMPLIANCE_ACTION_PATTERN.test(normalized)
    || GENERIC_CASE_LAW_REQUEST_PATTERN.test(normalized);
}

function hasPositiveFachSignal(question: string): boolean {
  return hasDomainSignal(question) || hasConservativeDomainScopeSignal(question);
}

function isExplicitNonFachQuestion(question: string): boolean {
  const normalized = normalizeText(question);
  if (!normalized || NON_FACH_STANDALONE_PATTERN.test(normalized)) {
    return true;
  }
  if (PRODUCT_META_PATTERN.test(normalized)) {
    return true;
  }
  if (!hasPositiveFachSignal(normalized) && (
    CLEAR_NON_FACH_TOPIC_PATTERN.test(normalized)
    || AUTHORSHIP_INTENT_PATTERN.test(normalized)
    || GENERAL_EXPLANATION_INTENT_PATTERN.test(normalized)
      && CLEAR_GENERAL_KNOWLEDGE_TOPIC_PATTERN.test(normalized)
    || GENERAL_TASK_INTENT_PATTERN.test(normalized)
  )) {
    return true;
  }
  // A concrete legal signal wins over broad words such as "Antwort" or
  // "liefert", which may also occur in an ordinary legal question.
  return !hasPositiveFachSignal(normalized)
    && (PROMPT_META_PATTERN.test(normalized) || GENERIC_META_PATTERN.test(normalized));
}

function isContextualFollowUp(question: string): boolean {
  const normalized = normalizeText(question);
  return Boolean(
    normalized
      && normalized.length <= 220
      && !isExplicitNonFachQuestion(normalized)
      && (
        CONTEXTUAL_FOLLOW_UP_PATTERN.test(normalized)
        || CONTEXT_DEPENDENT_QUESTION_PATTERN.test(normalized)
      ),
  );
}

function isContextFreeFragment(question: string): boolean {
  const normalized = normalizeText(question);
  return CONTEXT_FREE_FRAGMENT_PATTERN.test(normalized)
    || CONTEXT_DEPENDENT_QUESTION_PATTERN.test(normalized);
}

function userTurns(
  conversation: readonly RetrievalConversationMessage[],
): Array<Readonly<{ content: string; conversationIndex: number }>> {
  return conversation.flatMap((message, conversationIndex) => {
    const content = message.content.trim();
    return message.role === "user" && content
      ? [{ content, conversationIndex }]
      : [];
  });
}

function contextualQuestionChain(
  turns: ReadonlyArray<Readonly<{ content: string; conversationIndex: number }>>,
): string[] {
  const latest = turns.at(-1);
  if (!latest || !isContextualFollowUp(latest.content)) {
    return [];
  }

  const precedingFollowUps: string[] = [];
  for (let index = turns.length - 2; index >= 0; index -= 1) {
    const question = turns[index].content;
    // An explicit non-specialist turn is a topic boundary. Never scan through
    // it and reactivate an older legal topic.
    if (isExplicitNonFachQuestion(question)) {
      return [];
    }
    if (isContextualFollowUp(question)) {
      precedingFollowUps.unshift(question);
      continue;
    }
    if (isContextFreeFragment(question)) {
      return [];
    }

    // A short fragment may inherit only a positively classified Fach root.
    // General knowledge and arbitrary everyday requests are topic boundaries.
    if (!hasPositiveFachSignal(question)) {
      return [];
    }
    return [
      question,
      ...precedingFollowUps.slice(-(MAX_CONTEXT_USER_TURNS - 2)),
      latest.content,
    ];
  }
  return [];
}

function formatContextualSearchQuery(questions: readonly string[]): string {
  if (questions.length <= 1) {
    return questions[0] ?? "";
  }
  const [rootQuestion, ...followUps] = questions;
  return [
    `Ausgangsfrage: ${rootQuestion}`,
    ...followUps.map((question, index) =>
      `${index === followUps.length - 1 ? "Aktuelle Folgefrage" : "Zwischenfrage"}: ${question}`,
    ),
  ].join("\n");
}

function appendSupplementalSearchContext(question: string, supplementalContext?: string): string {
  const context = supplementalContext?.trim();
  if (!context) {
    return question;
  }
  const prefix = question.trim() ? [question.trim(), ""] : [];
  return [
    ...prefix,
    "Ergänzender Anhangkontext (nur Suchkontext):",
    context,
  ].join("\n");
}

function requiredToolsForQuestions(questions: readonly string[]): RequiredRetrievalToolName[] {
  const normalized = normalizeText(questions.join("\n"));
  const isInternalOrganizationQuestion = INTERNAL_ORGANIZATION_PATTERN.test(normalized);
  const required: RequiredRetrievalToolName[] = isInternalOrganizationQuestion
    && !LEGAL_SUBSTANCE_PATTERN.test(normalized)
    ? []
    : [REQUIRED_FIRST_RETRIEVAL_TOOL];
  if (BFG_SOURCE_PATTERN.test(normalized)
    || !OTHER_COURT_SOURCE_PATTERN.test(normalized) && GENERIC_CASE_LAW_REQUEST_PATTERN.test(normalized)) {
    required.push("search_bfg");
  }
  if (INTERNAL_PRACTICE_SOURCE_PATTERN.test(normalized)) {
    required.push("search_win_anv", "search_fexklusiv");
  }
  if (WORK_AIDS_SOURCE_PATTERN.test(normalized) || isInternalOrganizationQuestion) {
    required.push("search_work_aids");
  }
  return required;
}

function fachfrageState(options: {
  classificationReason: Exclude<RetrievalClassificationReason, "non_fachfrage">;
  latestQuestion: string;
  searchQuery: string;
  contextQuestions: readonly string[];
}): RetrievalGateState {
  const requiredTools = requiredToolsForQuestions(options.contextQuestions);
  return {
    kind: "fachfrage",
    phase: requiredTools[0] === REQUIRED_FIRST_RETRIEVAL_TOOL
      ? "law_search_required"
      : "law_search_completed",
    classificationReason: options.classificationReason,
    latestQuestion: options.latestQuestion,
    searchQuery: options.searchQuery,
    contextQuestions: options.contextQuestions,
    requiredTools,
    completedTools: [],
    lawSearchAttempts: 0,
  };
}

/**
 * Classifies the current user turn against the complete user-turn history and
 * creates the initial immutable workflow state.
 */
export function createRetrievalGate(
  conversation: readonly RetrievalConversationMessage[],
  options: RetrievalGateOptions = {},
): RetrievalGateState {
  const turns = userTurns(conversation);
  const latestQuestion = turns.at(-1)?.content ?? "";

  if (options.forceFachfrage && (latestQuestion || options.supplementalSearchContext?.trim())) {
    return fachfrageState({
      classificationReason: "attachment_context",
      latestQuestion,
      searchQuery: appendSupplementalSearchContext(
        latestQuestion,
        options.supplementalSearchContext,
      ),
      contextQuestions: latestQuestion ? [latestQuestion] : [],
    });
  }

  // Unambiguous product/meta questions are deliberate topic boundaries even
  // when they mention the name of a legal database such as BFG.
  if (isExplicitNonFachQuestion(latestQuestion)) {
    return {
      kind: "non_fachfrage",
      phase: "ready_to_finalize",
      classificationReason: "non_fachfrage",
      latestQuestion,
      searchQuery: latestQuestion,
      contextQuestions: latestQuestion ? [latestQuestion] : [],
      requiredTools: [],
      completedTools: [],
      lawSearchAttempts: 0,
    };
  }

  // Resolve a fragment against the nearest uninterrupted user topic before a
  // direct keyword in the fragment is allowed to discard its antecedent.
  if (isContextualFollowUp(latestQuestion)) {
    const contextQuestions = contextualQuestionChain(turns);
    if (contextQuestions.length > 0) {
      return fachfrageState({
        classificationReason: "contextual_follow_up",
        latestQuestion,
        searchQuery: formatContextualSearchQuery(contextQuestions),
        contextQuestions,
      });
    }
  }

  if (hasPositiveFachSignal(latestQuestion)) {
    return fachfrageState({
      classificationReason: hasDomainSignal(latestQuestion)
        ? "direct_domain_signal"
        : "default_domain_scope",
      latestQuestion,
      searchQuery: latestQuestion,
      contextQuestions: [latestQuestion],
    });
  }

  return {
    kind: "non_fachfrage",
    phase: "ready_to_finalize",
    classificationReason: "non_fachfrage",
    latestQuestion,
    searchQuery: latestQuestion,
    contextQuestions: latestQuestion ? [latestQuestion] : [],
    requiredTools: [],
    completedTools: [],
    lawSearchAttempts: 0,
  };
}

/** Returns the next deterministic action instead of asking the model to route it. */
export function requiredRetrievalAction(
  state: RetrievalGateState,
): RequiredRetrievalAction | undefined {
  if (state.kind !== "fachfrage") {
    return undefined;
  }
  const completed = new Set(state.completedTools);
  const toolName = state.requiredTools.find((requiredTool) => !completed.has(requiredTool));
  return toolName
    ? { toolName, arguments: { query: state.searchQuery } }
    : undefined;
}

/** Prevents optional or later tools from overtaking a mandatory step. */
export function evaluateRetrievalToolCall(
  state: RetrievalGateState,
  toolName: string,
): RetrievalGateDecision {
  const requiredAction = requiredRetrievalAction(state);
  if (!requiredAction || toolName === requiredAction.toolName) {
    return { allowed: true };
  }
  if (requiredAction.toolName === REQUIRED_FIRST_RETRIEVAL_TOOL) {
    return {
      allowed: false,
      code: "law_search_must_run_first",
      message: "Bei einer Fachfrage muss zuerst die vollständige Frage in Gesetze und Verordnungen recherchiert werden.",
    };
  }
  return {
    allowed: false,
    code: "required_retrieval_step_pending",
    message: `Vor weiteren Rechercheschritten muss zuerst ${requiredAction.toolName} erfolgreich abgeschlossen werden.`,
  };
}

/**
 * Advances the gate only when the currently required step succeeds. Failed
 * attempts stay retryable, and out-of-order results never unlock a later step.
 */
export function recordRetrievalToolResult(
  state: RetrievalGateState,
  result: RetrievalToolResult,
): RetrievalGateState {
  if (state.kind !== "fachfrage") {
    return state;
  }

  const lawSearchAttempts = state.lawSearchAttempts
    + (result.toolName === REQUIRED_FIRST_RETRIEVAL_TOOL ? 1 : 0);
  const requiredAction = requiredRetrievalAction(state);
  if (!requiredAction || result.toolName !== requiredAction.toolName || !result.success) {
    return lawSearchAttempts === state.lawSearchAttempts
      ? state
      : { ...state, lawSearchAttempts };
  }

  const completedTools = [...state.completedTools, requiredAction.toolName];
  const allCompleted = state.requiredTools.every((toolName) => completedTools.includes(toolName));
  return {
    ...state,
    phase: allCompleted ? "ready_to_finalize" : "law_search_completed",
    completedTools,
    lawSearchAttempts,
  };
}

/** Prevents a Fachantwort before every mandatory retrieval step succeeded. */
export function evaluateRetrievalFinalization(
  state: RetrievalGateState,
): RetrievalGateDecision {
  const requiredAction = requiredRetrievalAction(state);
  if (!requiredAction) {
    return { allowed: true };
  }
  if (requiredAction.toolName === REQUIRED_FIRST_RETRIEVAL_TOOL) {
    return {
      allowed: false,
      code: "law_search_not_completed",
      message: "Die Fachantwort darf erst nach einer erfolgreichen Gesetzesrecherche finalisiert werden.",
    };
  }
  return {
    allowed: false,
    code: "required_retrieval_steps_not_completed",
    message: `Die Fachantwort darf erst nach dem verpflichtenden Rechercheschritt ${requiredAction.toolName} finalisiert werden.`,
  };
}
