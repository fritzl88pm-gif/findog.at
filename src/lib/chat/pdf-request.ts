const PDF_TERM_PATTERN = /\bpdf(?:s|-datei(?:en)?|-dokument(?:e)?)?\b/i;
const PDF_ACTION_PATTERN = /\b(?:erstelle|erstellen|erzeuge|erzeugen|generiere|generieren|ausgeben|exportiere|exportieren|speichere|speichern|bereitstellen|anfertigen|herunterladen|downloade|downloaden)\b|\b(?:gib\b.{0,80}\baus|stell\b.{0,80}\bbereit|fertige\b.{0,80}\ban|lade\b.{0,80}\bherunter)\b/i;
const PDF_FORMAT_REQUEST_PATTERN = /\bals\s+(?:eine?\s+)?pdf(?:-datei(?:en)?|-dokument(?:e)?)?\b/i;

const INFORMATION_QUESTION_PATTERN = /^(?:(?:wie|wo|warum|wann|was|wer|welch\w*|womit|wofür)\b|(?:kann|könnte|soll|sollte|muss|darf)\s+(?:ich|man)\b|(?:ist|wäre)\s+es\b|gibt\s+es\b)/i;
const EXPLANATION_REQUEST_PATTERN = /\b(?:erkläre|erklären|zeige|zeigen|beschreibe|beschreiben)\b.{0,80}\b(?:wie|ob)\b/i;
const UPLOAD_METADATA_PATTERN = /^(?:PDF-Anhang|Bild-Anhang):\s*.+$/gim;

export function isExplicitPdfCreationRequest(userMessage: string): boolean {
  const request = userMessage.replace(UPLOAD_METADATA_PATTERN, " ").trim();

  if (
    !request
    || !PDF_TERM_PATTERN.test(request)
    || (!PDF_ACTION_PATTERN.test(request) && !PDF_FORMAT_REQUEST_PATTERN.test(request))
  ) {
    return false;
  }

  return !INFORMATION_QUESTION_PATTERN.test(request) && !EXPLANATION_REQUEST_PATTERN.test(request);
}

export function shouldOfferChatPdfDownload(
  precedingUserMessage: string,
  assistantAnswer: string,
): boolean {
  return assistantAnswer.trim().length > 0 && isExplicitPdfCreationRequest(precedingUserMessage);
}
