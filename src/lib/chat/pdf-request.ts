const PDF_TERM_PATTERN = /\bpdf(?:s|-datei(?:en)?|-dokument(?:e)?)?\b/i;
const PDF_ACTION_PATTERN = /\b(?:erstelle|erstellen|erzeuge|erzeugen|generiere|generieren|mache|mach|ausgeben|exportiere|exportieren|speichere|speichern|bereitstellen|anfertigen|herunterladen|downloade|downloaden)\b|\b(?:gib\b.{0,80}\baus|stell\b.{0,80}\bbereit|fertige\b.{0,80}\ban|lade\b.{0,80}\bherunter)\b/i;
const PDF_FORMAT_REQUEST_PATTERN = /\bals\s+(?:eine?\s+)?pdf(?:-datei(?:en)?|-dokument(?:e)?)?\b/i;
const PDF_ONLY_REQUEST_PATTERN = /^(?:bitte\s+)?pdf(?:-datei|-dokument|-export)?(?:\s+bitte)?[.!?]*$/i;
const REFERENTIAL_PDF_TARGET_PATTERN = /\b(?:diese[rsn]?|jene[rsn]?|obige[rsn]?|vorige[rsn]?|vorherige[rsn]?|vorstehende[rsn]?|bisherige[rsn]?|soeben\s+erstellte[rsn]?|zuletzt\s+erstellte[rsn]?)\s+(?:antwort|aufstellung|übersicht|zusammenfassung|entwurf|ausarbeitung|begründung(?:en)?|ergebnis|tabelle|liste|text|inhalt)\b|\b(?:davon|daraus|hieraus)\s+(?:bitte\s+)?(?:eine?\s+)?pdf\b/i;
const BARE_PDF_FOLLOW_UP_PATTERN = /^(?:bitte\s+)?(?:(?:das|dies)\s+)?(?:noch\s+)?(?:einmal\s+)?als\s+(?:eine?\s+)?pdf(?:-datei|-dokument)?(?:\s+(?:ausgeben|exportieren|bereitstellen))?(?:\s+bitte)?[.!?]*$|^(?:bitte\s+)?pdf(?:-datei|-dokument|-export)?(?:\s+bitte)?[.!?]*$/i;
const SUBSTANTIVE_PDF_CHANGE_PATTERN = /\b(?:ergänze|ergänzen|aktualisiere|aktualisieren|überarbeite|überarbeiten|erweitere|erweitern|prüfe|prüfen|beurteile|beurteilen|recherchiere|recherchieren|füge\b.{0,40}\bhinzu|mit\s+stand\s+(?:19|20)\d{2}|zum\s+stand\s+(?:19|20)\d{2})\b/i;
const CLEAR_PDF_EXECUTION_PATTERN = /\b(?:diese[rsn]?|vorige[rsn]?|vorherige[rsn]?|obige[rsn]?)\s+(?:antwort|aufstellung|übersicht|zusammenfassung|ausarbeitung)\b.{0,100}\bpdf\b.{0,40}\bherunterladen\b|^(?:wie\s+(?:besprochen|vereinbart)),\s*(?:gib|erstelle|erzeuge|exportiere)\b|[?.!]\s*(?:erstelle|erzeuge|generiere|exportiere)\b.{0,120}\bpdf\b/i;
const CONTEXTUAL_PDF_INTRO_PATTERN = /^(?:wie\s+(?:besprochen|vereinbart)),/i;

const INFORMATION_QUESTION_PATTERN = /^(?:(?:wie|wo|warum|wann|was|wer|welch\w*|womit|wofür)\b|(?:kann|könnte|soll|sollte|muss|darf)\s+(?:ich|man)\b|(?:ist|wäre)\s+es\b|gibt\s+es\b)/i;
const EXPLANATION_REQUEST_PATTERN = /\b(?:erkläre|erklären|zeige|zeigen|beschreibe|beschreiben)\b.{0,80}\b(?:wie|ob)\b/i;
const UPLOAD_METADATA_PATTERN = /^(?:PDF-Anhang|Bild-Anhang):\s*.+$/gim;
const GENERIC_PDF_HEADING_PATTERN = /^(?:überblick|kurzantwort|antwort|ergebnis|ausarbeitung|pdf-dokument)$/i;

export function isExplicitPdfCreationRequest(userMessage: string): boolean {
  const request = userMessage.replace(UPLOAD_METADATA_PATTERN, " ").trim();

  if (
    !request
    || !PDF_TERM_PATTERN.test(request)
    || (
      !PDF_ACTION_PATTERN.test(request)
      && !PDF_FORMAT_REQUEST_PATTERN.test(request)
      && !PDF_ONLY_REQUEST_PATTERN.test(request)
      && !REFERENTIAL_PDF_TARGET_PATTERN.test(request)
    )
  ) {
    return false;
  }

  return CLEAR_PDF_EXECUTION_PATTERN.test(request)
    || (!INFORMATION_QUESTION_PATTERN.test(request) && !EXPLANATION_REQUEST_PATTERN.test(request));
}

/**
 * Recognizes PDF follow-ups that point back to content already present in the
 * conversation. The caller must additionally verify that a preceding assistant
 * answer exists before bypassing research.
 */
export function isExistingAnswerPdfRequest(userMessage: string): boolean {
  const request = userMessage.replace(UPLOAD_METADATA_PATTERN, " ").trim();
  return isReferentialPdfRequest(request) && !SUBSTANTIVE_PDF_CHANGE_PATTERN.test(request);
}

export function isReferentialPdfRequest(userMessage: string): boolean {
  const request = userMessage.replace(UPLOAD_METADATA_PATTERN, " ").trim();
  return Boolean(
    request
    && PDF_TERM_PATTERN.test(request)
    && (
      REFERENTIAL_PDF_TARGET_PATTERN.test(request)
      || BARE_PDF_FOLLOW_UP_PATTERN.test(request)
      || CONTEXTUAL_PDF_INTRO_PATTERN.test(request)
    ),
  );
}

function cleanPdfTitle(value: string): string {
  return value
    .replace(/(?:\*\*|__|`)/g, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim();
}

export function derivePdfOfferTitle(answer: string, sourceQuestion: string): string {
  for (const match of answer.matchAll(/^#{1,4}\s+(.+)$/gm)) {
    const heading = cleanPdfTitle(match[1] ?? "");
    if (heading.length >= 4 && !GENERIC_PDF_HEADING_PATTERN.test(heading)) {
      return heading.slice(0, 160);
    }
  }

  const questionTitle = cleanPdfTitle(
    sourceQuestion
      .replace(UPLOAD_METADATA_PATTERN, " ")
      .replace(/\bals\s+(?:eine?\s+)?pdf(?:-datei|-dokument)?\b/gi, " ")
      .replace(/\bpdf(?:-datei|-dokument)?\b/gi, " ")
      .replace(/\b(?:bitte|erstelle|erstellen|erzeuge|erzeugen|generiere|generieren|exportiere|exportieren|ausgeben|bereitstellen|herunterladen)\b/gi, " ")
      .replace(/[?!.]+$/g, " "),
  );
  return (questionTitle || "Findog-Ausarbeitung").slice(0, 160);
}
