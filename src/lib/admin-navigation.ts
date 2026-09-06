export type AdminEditorState = { dirty: boolean; busy: boolean };

export function mayLeaveAdminEditor(
  states: Iterable<AdminEditorState>,
  confirmDiscard: () => boolean,
  notifyBusy: () => void,
): boolean {
  const entries = [...states];
  if (entries.some((entry) => entry.busy)) {
    notifyBusy();
    return false;
  }
  return !entries.some((entry) => entry.dirty) || confirmDiscard();
}

export const ADMIN_AREAS = [
  { id: "benutzer", group: "Benutzer & Feedback", title: "Benutzer", description: "Konten verwalten und vorhandene Anfragen einsehen.", icon: "users" },
  { id: "feedback", group: "Benutzer & Feedback", title: "Rückmeldungen", description: "Gemeldete Fred-Antworten mit ihrem Kontext prüfen.", icon: "feedback" },
  { id: "downloads", group: "Inhalte", title: "Downloads", description: "Dateien bereitstellen und Kategorien organisieren.", icon: "download" },
  { id: "dashboard-news", group: "Inhalte", title: "Plattformupdates", description: "Neuigkeiten und Hinweise zu findog.at veröffentlichen.", icon: "news" },
  { id: "bfg-newsletters", group: "Inhalte", title: "BFG Newsletter", description: "Datierte Ausgaben anlegen und bearbeiten.", icon: "mail" },
  { id: "scanning", group: "System", title: "Dokumentverarbeitung", description: "Fred-Anhänge, OCR und Belegauswertung konfigurieren.", icon: "scan" },
  { id: "omniroute", group: "System", title: "Nutzung & Systemstatus", description: "OmniRoute-Nutzung, Modelle und Systemzustand prüfen.", icon: "chart" },
] as const;

export type AdminArea = "overview" | typeof ADMIN_AREAS[number]["id"];
export const ADMIN_AREA_GROUPS = ["Benutzer & Feedback", "Inhalte", "System"] as const;
