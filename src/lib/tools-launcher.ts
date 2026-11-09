/**
 * Entries of the "Werkzeuge" launcher in the top-right header bar.
 * Every `id` equals the AppView the tile opens.
 */
export type LauncherToolId =
  | "bfg-decisions"
  | "bfg-pro"
  | "bfg-newsletters"
  | "data"
  | "scanning"
  | "reasonings"
  | "forms"
  | "downloads"
  | "german-sv-pension"
  | "l17b-currency"
  | "fredrun"
  | "fredrun2"
  | "quiz"
  | "fred-live";

export type LauncherIconName =
  | "search"
  | "sparkles"
  | "newsletter"
  | "database"
  | "scan"
  | "text"
  | "form"
  | "download"
  | "calculator"
  | "currency"
  | "game"
  | "bolt"
  | "quiz"
  | "headset";

export type LauncherTone = "research" | "documents" | "calculators" | "learning";

export type LauncherTool = {
  id: LauncherToolId;
  label: string;
  icon: LauncherIconName;
  adminOnly?: true;
};

export type LauncherGroup = {
  id: string;
  title: string;
  tone: LauncherTone;
  tools: LauncherTool[];
};

export const LAUNCHER_GROUPS: readonly LauncherGroup[] = [
  {
    id: "recherche",
    title: "Recherche",
    tone: "research",
    tools: [
      { id: "bfg-decisions", label: "BFG Suche", icon: "search" },
      { id: "bfg-pro", label: "BFG Suche PRO", icon: "sparkles" },
      { id: "bfg-newsletters", label: "BFG Newsletter", icon: "newsletter" },
      { id: "data", label: "Wissensbestand", icon: "database" },
    ],
  },
  {
    id: "dokumente",
    title: "Dokumente",
    tone: "documents",
    tools: [
      { id: "scanning", label: "Dokumente scannen", icon: "scan" },
      { id: "reasonings", label: "Textbausteine", icon: "text" },
      { id: "forms", label: "Formulare", icon: "form" },
      { id: "downloads", label: "Downloads", icon: "download" },
    ],
  },
  {
    id: "rechner",
    title: "Rechner",
    tone: "calculators",
    tools: [
      { id: "german-sv-pension", label: "Deutsche SV-Rente", icon: "calculator" },
      { id: "l17b-currency", label: "L17b-Rechner", icon: "currency" },
    ],
  },
  {
    id: "lernen-spiel",
    title: "Lernen & Spiel",
    tone: "learning",
    tools: [
      { id: "fredrun", label: "Fredrun", icon: "game" },
      { id: "fredrun2", label: "Fredrun 2.0", icon: "bolt" },
      { id: "quiz", label: "Quiz", icon: "quiz", adminOnly: true },
      { id: "fred-live", label: "Fred Live", icon: "headset", adminOnly: true },
    ],
  },
];

/** Groups visible to the current user; admin-only tools and groups left empty by that are dropped. */
export function getLauncherGroups(isAdmin: boolean): LauncherGroup[] {
  return LAUNCHER_GROUPS
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) => isAdmin || !tool.adminOnly),
    }))
    .filter((group) => group.tools.length > 0);
}

export function getLauncherToolIds(isAdmin: boolean): LauncherToolId[] {
  return getLauncherGroups(isAdmin).flatMap((group) => group.tools.map((tool) => tool.id));
}
