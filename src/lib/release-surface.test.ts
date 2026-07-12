import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("approved release surface", () => {
  const pagePath = fileURLToPath(new URL("../app/page.tsx", import.meta.url));
  const globalsPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const layoutPath = fileURLToPath(new URL("../app/layout.tsx", import.meta.url));
  const publicSettingsPath = fileURLToPath(new URL("../app/api/settings/route.ts", import.meta.url));
  const adminSettingsPath = fileURLToPath(new URL("../app/api/admin/settings/route.ts", import.meta.url));
  const faviconPath = fileURLToPath(new URL("../../public/favicon.png", import.meta.url));
  const bfgIllustrationPath = fileURLToPath(new URL("../../public/fred-bfg-search.png", import.meta.url));
  const bfgProIllustrationPath = fileURLToPath(new URL("../../public/fred-bfg-pro-search.png", import.meta.url));
  const germanSvPensionIllustrationPath = fileURLToPath(new URL("../../public/fred-german-sv-pension.png", import.meta.url));
  const germanSvPensionPath = fileURLToPath(new URL("./german-sv-pension.ts", import.meta.url));
  const pageSource = readFileSync(pagePath, "utf8");
  const globalsSource = readFileSync(globalsPath, "utf8");
  const layoutSource = readFileSync(layoutPath, "utf8");
  const publicSettingsSource = readFileSync(publicSettingsPath, "utf8");
  const adminSettingsSource = readFileSync(adminSettingsPath, "utf8");
  const germanSvPensionSource = readFileSync(germanSvPensionPath, "utf8");

  it("labels the standalone BFG view as BFG Suche in expanded and collapsed navigation", () => {
    expect(pageSource).toMatch(/className={`sidebar-view-button[\s\S]*?<\/svg>\s*BFG Suche\s*<\/button>/);
    expect(pageSource).toContain('title="BFG Suche"');
    expect(pageSource).toContain('aria-label="BFG Suche"');
    expect(pageSource).toContain('<h1 id="bfg-decisions-view-title">BFG-Entscheidungen</h1>');
    expect(pageSource).toContain('appView === "bfg-decisions"');
    expect(pageSource).toContain('/api/findok/bfg');
  });

  it("adds a separate BFG Suche PRO view and controls without replacing the normal search", () => {
    expect(pageSource).toContain('type AppView = "chat" | "forms" | "bfg-decisions" | "bfg-pro" | "german-sv-pension" | "administration"');
    expect(pageSource).toMatch(/className={`sidebar-view-button[\s\S]*?BFG Suche PRO\s*<\/button>/);
    expect(pageSource).toContain('title="BFG Suche PRO"');
    expect(pageSource).toContain('aria-label="BFG Suche PRO"');
    expect(pageSource).toContain('appView === "bfg-pro"');
    expect(pageSource).toContain('<h1 id="bfg-pro-view-title">BFG Suche PRO</h1>');
    expect(pageSource).toContain("KI-gestützte Reihung auf Basis veröffentlichter Findok BFG-Entscheidungen");
    expect(pageSource).toContain('htmlFor="bfg-pro-scenario"');
    expect(pageSource).toContain('<textarea');
    expect(pageSource).toContain('/api/findok/bfg/pro');
    expect(pageSource).toContain('Warum relevant');
    expect(pageSource).toContain('<h3>Sachverhalt</h3>');
    expect(pageSource).not.toContain('Originaltext-Auszug');
    expect(pageSource).toContain('Keine relevanten BFG-Entscheidungen gefunden.');
    expect(pageSource).toContain('/api/findok/bfg?');
  });

  it("adds the local Deutsche SV Rente AppView directly below BFG Suche PRO", () => {
    const expandedNavigation = pageSource.slice(
      pageSource.indexOf('<nav className="forms-navigation"'),
      pageSource.indexOf('</nav>', pageSource.indexOf('<nav className="forms-navigation"')),
    );
    const collapsedRail = pageSource.slice(
      pageSource.indexOf('<div className="rail-content">'),
      pageSource.indexOf('<div className="sidebar-footer">'),
    );
    const pensionView = pageSource.slice(
      pageSource.indexOf('function GermanSvPensionView('),
      pageSource.indexOf('export default function Home()'),
    );

    expect(expandedNavigation).toMatch(/BFG Suche PRO\s*<\/button>\s*<button[\s\S]*?appView === "german-sv-pension"[\s\S]*?Deutsche SV Rente\s*<\/button>/);
    expect(collapsedRail).toMatch(/title="BFG Suche PRO"[\s\S]*?<\/button>\s*<button[\s\S]*?title="Deutsche SV Rente"[\s\S]*?aria-label="Deutsche SV Rente"/);
    expect(pageSource).toContain('appView === "german-sv-pension"');
    expect(pageSource).toContain('<GermanSvPensionView');
    expect(pensionView).toContain('<fieldset className="german-sv-mode">');
    expect(pensionView.match(/type="radio"/g)).toHaveLength(2);
    expect(pensionView.match(/id="german-sv-pension-amount"/g)).toHaveLength(1);
    expect(pensionView).toContain('inputMode="decimal"');
    expect(pensionView).toContain('aria-live="polite"');
    expect(pensionView).not.toContain("fetch(");
    expect(pensionView).not.toContain("localStorage");
    expect(pensionView).not.toContain("/api/");
    expect(germanSvPensionSource).not.toContain("fetch(");
    expect(germanSvPensionSource).not.toContain("localStorage");
    expect(pageSource).toContain('onDownloadPdf={downloadGermanSvPensionPdf}');
    expect(pageSource).toContain('fetch("/api/documents/pdf"');
  });

  it("updates the authoritative Deutsche SV Rente copy and preserves calculator output", () => {
    for (const requiredText of [
      "KV-Beitrag",
      "Rentenbrutto / AEOI-KM",
      "Krankenversicherung gem. § 73a ASVG",
      "dt. Zuschuss zur Krankenversicherung",
      "dt. „Jahresbetrag der Rente“ = Bmgl. KV",
      "Steuerpflichtige Einkünfte",
      "Sozialversicherungsbeiträge (KV-Beitrag)",
      "Kz 453",
      "Kz 184",
      "Stand 26.06.2026",
    ]) {
      expect(pageSource).toContain(requiredText);
    }

    expect(pageSource).not.toContain("Kz-Tool · § 73a ASVG");
    expect(pageSource).not.toContain("Berechnung aus deutscher SV-Rente anhand KV-Bemessungsgrundlage bzw. AEOI-KM.");
    expect(pageSource).not.toContain("Es kann zu Rundungsdifferenzen kommen — im deutschen Bescheid wird der Jahresbetrag der Rente abgerundet.");
    expect(pageSource).not.toContain("Nicht anwendbar bei Renten aus der Schweiz und Liechtenstein, da der Wechselkurs AJ-Web/PVA ≠ L17b ist.");
    expect(pageSource).toContain('{option === 2024 ? "bis 2024" : option}');
    expect(pageSource).toContain('onClick={() => setYear(option)}');
    expect(pageSource).toContain('disabled={calculation === null || isDownloadingPdf}');
    expect(pageSource).toContain("Berechnung als PDF herunterladen");
    expect(globalsSource).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.german-sv-mode,[\s\S]*?\.german-sv-results \{\s*grid-template-columns: 1fr;/);
  });

  it("shows the verified decorative SV-Rente illustration in the responsive header", () => {
    const pensionView = pageSource.slice(
      pageSource.indexOf('function GermanSvPensionView('),
      pageSource.indexOf('export default function Home()'),
    );

    expect(pensionView).toMatch(
      /<header className="forms-view-header bfg-view-header german-sv-pension-header">[\s\S]*?<h1 id="german-sv-pension-view-title">Kennzahl 453 &amp; 184<\/h1>[\s\S]*?<Image[\s\S]*?className="bfg-view-header-illustration"[\s\S]*?src="\/fred-german-sv-pension\.png"[\s\S]*?alt=""[\s\S]*?width=\{376\}[\s\S]*?height=\{376\}[\s\S]*?unoptimized[\s\S]*?<\/header>/,
    );
    expect(createHash("sha256").update(readFileSync(germanSvPensionIllustrationPath)).digest("hex")).toBe(
      "6e7f0c0e7dc3b4c7fd12f8882d21c9bb0ed324b81e502fae5f4bddfd5afeec69",
    );
    expect(globalsSource).toMatch(
      /\.bfg-view-header-illustration \{[\s\S]*?width: 100%;[\s\S]*?max-width: 240px;[\s\S]*?height: auto;[\s\S]*?\}/,
    );
  });

  it("keeps system prompt controls and data on the admin-only surface", () => {
    const settingsDialog = pageSource.slice(
      pageSource.indexOf('{isSettingsDialogOpen ? ('),
      pageSource.indexOf('{appView === "bfg-pro" ? ('),
    );
    const chatSubmit = pageSource.slice(
      pageSource.indexOf('async function handleSubmit('),
      pageSource.indexOf('async function handlePasswordChange('),
    );

    expect(settingsDialog).not.toContain('settings-tab-system-prompt');
    expect(settingsDialog).not.toContain('id="system-prompt"');
    expect(settingsDialog).not.toContain('Auf Standard zurücksetzen');
    expect(settingsDialog).not.toContain('MAX_SYSTEM_PROMPT_CHARS');
    expect(settingsDialog).not.toContain('<textarea');
    expect(settingsDialog).toContain('settings-tab-model');
    expect(settingsDialog).toContain('settings-tab-password');
    expect(chatSubmit).not.toContain('systemPromptForChatRequest');
    expect(chatSubmit).not.toContain('usesGlobalDefault');
    expect(chatSubmit).not.toContain('requestBody.systemPrompt');
    expect(publicSettingsSource).not.toContain('globalSystemPrompt');
    expect(pageSource).toContain('<h2>Globaler System Prompt</h2>');
    expect(pageSource).toContain('id="admin-system-prompt"');
    expect(adminSettingsSource).toContain('getGlobalSystemPrompt');
    expect(adminSettingsSource).toContain('updateGlobalSystemPrompt');
  });

  it("registers the supplied favicon and preserves the approved metadata copy", () => {
    expect(layoutSource).toContain('title: "Findog/Fred"');
    expect(layoutSource).toContain(
      'description: "KI-Assistent fuer oesterreichisches Steuerrecht mit Fachdatenbank-Recherche."',
    );
    expect(layoutSource).toMatch(/icons:\s*\{\s*icon:\s*"\/favicon\.png",?\s*\}/);
    expect(createHash("sha256").update(readFileSync(faviconPath)).digest("hex")).toBe(
      "44239860c1028844639dff3d1cbf02f42c5b26e8f285e6e1572d002f40105395",
    );
  });

  it("shows the supplied decorative illustration beside the exact BFG introduction", () => {
    expect(pageSource).toContain(
      "Durchsuche veröffentlichte Entscheidungen des Bundesfinanzgerichts in der Findok-Suche über das Suchfeld.",
    );
    expect(pageSource).toMatch(
      /<header className="forms-view-header bfg-view-header">[\s\S]*?<Image[\s\S]*?src="\/fred-bfg-search\.png"[\s\S]*?alt=""[\s\S]*?<\/header>/,
    );
    expect(pageSource).toMatch(/src="\/fred-bfg-search\.png"[\s\S]*?unoptimized/);
    expect(createHash("sha256").update(readFileSync(bfgIllustrationPath)).digest("hex")).toBe(
      "d62ae28a021cbe776d5c39ccbd531ad7ca75f9103be9e5f3c499c32a721a9c67",
    );
  });

  it("shows the verified decorative PRO illustration in the responsive BFG header", () => {
    const bfgProHeader = pageSource.slice(
      pageSource.indexOf('{appView === "bfg-pro" ? ('),
      pageSource.indexOf(') : appView === "bfg-decisions" ? ('),
    );

    expect(bfgProHeader).toMatch(
      /<header className="forms-view-header bfg-view-header">[\s\S]*?<div className="bfg-view-header-copy">[\s\S]*?<Image[\s\S]*?className="bfg-view-header-illustration"[\s\S]*?src="\/fred-bfg-pro-search\.png"[\s\S]*?alt=""[\s\S]*?width=\{313\}[\s\S]*?height=\{313\}[\s\S]*?unoptimized[\s\S]*?<\/header>/,
    );
    const illustration = readFileSync(bfgProIllustrationPath);
    expect(illustration.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(createHash("sha256").update(illustration).digest("hex")).toBe(
      "bffb1e4813e1714c8af53d22512f2d6358723e1b10873d5e627c7757efad5fe2",
    );
  });

  it("keeps the BFG header illustration responsive without horizontal overflow", () => {
    expect(globalsSource).toMatch(
      /\.bfg-view-header \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(160px, 240px\);[\s\S]*?\}/,
    );
    expect(globalsSource).toMatch(
      /\.bfg-view-header-illustration \{[\s\S]*?width: 100%;[\s\S]*?max-width: 240px;[\s\S]*?height: auto;[\s\S]*?\}/,
    );
    expect(globalsSource).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.bfg-view-header \{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\}/,
    );
  });

  it("offers the approved compact BFG sort and collapsible facet controls", () => {
    expect(pageSource).toContain('aria-label="Sortierung"');
    expect(pageSource).toContain("Genehmigungsdatum absteigend");
    expect(pageSource).toContain("Genehmigungsdatum aufsteigend");
    expect(pageSource).toContain("In Findok seit absteigend");
    expect(pageSource).toContain("In Findok seit aufsteigend");
    expect(pageSource).toContain("Geschäftszahl");
    expect(pageSource).toContain('aria-expanded={isBfgFilterPanelOpen}');
    expect(pageSource).toContain("Materie");
    expect(pageSource).toContain("Dokumenttyp");
    expect(pageSource).toContain("Norm");
    expect(pageSource).toContain("Zeitraum");
    expect(pageSource).toContain("Mit Rechtssatz");
    expect(pageSource).toContain("Anwenden");
    expect(pageSource).toContain("Zurücksetzen");
    expect(pageSource).toContain('parameters.set("sort", controls.sort)');
    expect(pageSource).toContain("bfgAppliedFilters");
  });

  it("renders the expanded findog.at brand as a home link with a Beta tag", () => {
    expect(pageSource).toMatch(
      /<Link className="sidebar-brand" href="\/">[\s\S]*className="austria-flag"[\s\S]*findog\.at[\s\S]*Beta[\s\S]*<\/Link>/,
    );
  });

  it("keeps the client PDF fallback filename neutral", () => {
    expect(pageSource).toContain('?? "Antwort.pdf"');
    expect(pageSource).not.toContain("Findog_Antwort.pdf");
  });

  it("shows decorative link and red PDF icons in the BFG result actions", () => {
    expect(pageSource).toMatch(
      /<svg className="bfg-result-link-icon" aria-hidden="true"[\s\S]*?<\/svg>\s*Entscheidung öffnen/,
    );
    expect(pageSource).toMatch(
      /<svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true"[\s\S]*?<\/svg>\s*PDF öffnen/,
    );
    expect(globalsSource).toMatch(
      /\.bfg-result-links a \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?gap:/,
    );
    expect(globalsSource).toMatch(/\.bfg-result-pdf-icon \{[\s\S]*?color: var\(--danger\);/);
  });
});
