import { describe, expect, it } from "vitest";

import {
  createRetrievalGate,
  evaluateRetrievalFinalization,
  evaluateRetrievalToolCall,
  recordRetrievalToolResult,
  requiredRetrievalAction,
} from "./retrieval-gate";

describe("retrieval gate classification and context", () => {
  it("lets ordinary conversation finalize without research", () => {
    const state = createRetrievalGate([{ role: "user", content: "Hallo!" }]);

    expect(state).toMatchObject({
      kind: "non_fachfrage",
      phase: "ready_to_finalize",
      classificationReason: "non_fachfrage",
      requiredTools: [],
    });
    expect(requiredRetrievalAction(state)).toBeUndefined();
    expect(evaluateRetrievalFinalization(state)).toEqual({ allowed: true });
  });

  it("keeps an unambiguous product/retrieval meta-question outside legal research", () => {
    const state = createRetrievalGate([{
      role: "user",
      content: "Warum zeigt der Agent bei der BFG-Suche nur einen Treffer?",
    }]);

    expect(state.kind).toBe("non_fachfrage");
    expect(state.phase).toBe("ready_to_finalize");
  });

  it.each([
    "Wie wird das Wetter morgen?",
    "Was ist die Hauptstadt von Frankreich?",
    "Erzähl mir bitte einen Witz.",
    "Gib mir ein Rezept für Apfelkuchen.",
    "Bitte erkläre mir Quantenphysik.",
    "Wie funktioniert Photosynthese?",
    "Was ist Photosynthese?",
    "Wie funktioniert Zellatmung?",
    "Wie entsteht Gravitation?",
    "Wer schrieb Faust?",
    "Wer verfasste Die Verwandlung?",
    "Erkläre die Relativitätstheorie.",
    "Erkläre mir die Plattentektonik.",
    "Wie backe ich einen Apfelstrudel? Gib mir ein Rezept.",
    "Gib mir ein Rezept für Kürbissuppe.",
    "Schreibe ein Gedicht über den Sommer.",
    "Schreibe einen kurzen Text über den Frühling.",
    "Übersetze Guten Morgen ins Englische.",
    "Warum zeigt der Agent bei der Suche nur einen Treffer?",
    "Kann der Admin das Standardmodell ändern?",
    "Was ist Impressionismus?",
    "Wer war Napoleon?",
    "Erkläre Vulkanismus.",
    "Was ist künstliche Intelligenz?",
    "Berechne 2+2.",
    "Wer war Mozart?",
    "Nenne drei Planeten.",
    "Fasse Hamlet kurz zusammen.",
    "Wie spät ist es?",
    "Schreibe eine E-Mail an mein Team.",
  ])("recognizes a clearly non-legal topic without opening research: %s", (question) => {
    expect(createRetrievalGate([{ role: "user", content: question }])).toMatchObject({
      kind: "non_fachfrage",
      phase: "ready_to_finalize",
      requiredTools: [],
    });
  });

  it("does not let a prompt-related expense description suppress a tax question", () => {
    expect(createRetrievalGate([{
      role: "user",
      content: "Ist Prompt-Engineering als Werbungskosten absetzbar?",
    }])).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
    });
  });

  it.each([
    "Kann ich ein ärztliches Rezept als außergewöhnliche Belastung geltend machen?",
    "Kann ich Prompt-Engineering als Werbungskosten geltend machen?",
    "Kann ich einen beruflichen E-Mail-Dienst steuerlich absetzen?",
    "Muss eine Tagesmutter ihre Einnahmen versteuern?",
    "Kann ich die Kosten für einen zweiten Wohnsitz geltend machen?",
    "Darf das Finanzamt meine Erklärung prüfen?",
    "Kann ich Kinderbetreuungskosten abziehen?",
    "Ist eine Schenkung meldepflichtig?",
    "Wie ist ein Fahrtenbuch zu behandeln?",
    "Muss ich einen Grundstücksverkauf melden?",
    "Wie funktioniert die Verlustverrechnung?",
    "Erkläre das Zufluss-Abfluss-Prinzip.",
    "Erkläre mir den Progressionsvorbehalt.",
    "Wie funktioniert der Verlustvortrag?",
    "Erkläre Liebhaberei.",
  ])("lets a concrete tax question win over colliding general words: %s", (question) => {
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "direct_domain_signal",
      searchQuery: question,
      requiredTools: ["search_laws"],
    });
  });

  it("lets an unambiguous legal citation override a broad meta wording", () => {
    const question = "Warum liefert § 33 EStG diesen Betrag?";
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      classificationReason: "direct_domain_signal",
      searchQuery: question,
    });
  });

  it("uses a clearly marked supplemental attachment extract only in the search query", () => {
    const question = "Bitte den angehängten Bescheid prüfen.";
    const context = "Im Bescheid wird § 16 EStG zur doppelten Haushaltsführung genannt.";
    const state = createRetrievalGate(
      [{ role: "user", content: question }],
      { forceFachfrage: true, supplementalSearchContext: context },
    );

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "attachment_context",
      latestQuestion: question,
      contextQuestions: [question],
      requiredTools: ["search_laws"],
    });
    expect(state.searchQuery).toContain(question);
    expect(state.searchQuery).toContain("Ergänzender Anhangkontext (nur Suchkontext):");
    expect(state.searchQuery).toContain(context);
  });

  it("requires a deterministic first law search for a direct Fachfrage", () => {
    const question = "Kann eine Tagesmutter Werbungskosten geltend machen?";
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "direct_domain_signal",
      latestQuestion: question,
      searchQuery: question,
      requiredTools: ["search_laws"],
      completedTools: [],
    });
    expect(requiredRetrievalAction(state)).toEqual({
      toolName: "search_laws",
      arguments: { query: question },
    });
    expect(evaluateRetrievalFinalization(state)).toMatchObject({
      allowed: false,
      code: "law_search_not_completed",
    });
  });

  it("routes a pure internal organization question to work aids without a law search", () => {
    const state = createRetrievalGate([{
      role: "user",
      content: "Welche Dienststelle ist laut OHB für CC Scan zuständig?",
    }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      requiredTools: ["search_work_aids"],
    });
    expect(requiredRetrievalAction(state)?.toolName).toBe("search_work_aids");
  });

  it("keeps laws first when an organization question also contains legal substance", () => {
    const state = createRetrievalGate([{
      role: "user",
      content: "Welche Dienststelle bearbeitet laut OHB eine Beschwerde nach der BAO?",
    }]);

    expect(state.requiredTools).toEqual(["search_laws", "search_work_aids"]);
  });

  it("fails safe to research for an ambiguous substantive question", () => {
    const question = "Welche Nachweise müssen in diesem Fall aufbewahrt werden?";
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "default_domain_scope",
      searchQuery: question,
    });
  });

  it("keeps an unknown normative request in the fail-safe domain scope", () => {
    const question = "Wie ist diese neuartige Fallkonstellation zu behandeln?";
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "default_domain_scope",
      searchQuery: question,
      requiredTools: ["search_laws"],
    });
  });

  it("does not treat a generic explanation verb as proof of general knowledge", () => {
    const question = "Erkläre mir die Zurechnungsbesteuerung.";
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "default_domain_scope",
      searchQuery: question,
      requiredTools: ["search_laws"],
    });
  });

  it.each([
    "Wie wird die Fantasiesteuer berechnet?",
    "Was ist die Quallenzurechnungsbesteuerung?",
    "Wann fällt die Roboterabgabe an?",
    "Sind Wolkenarchivkosten abziehbar?",
    "Wie hoch ist der Mondförderbetrag?",
    "Besteht eine Drohnenmeldepflicht?",
    "Wann wird der Pixelprüfbescheid erlassen?",
    "Wie läuft das Satellitenabgabenverfahren?",
    "Welche Sternennachreichfrist gilt?",
    "Was regelt die Nebelpauschale?",
    "Wie wirkt der Quantenfreibetrag?",
    "Was ist die Kunststeuer?",
    "Erkläre die Musikabgabe.",
    "Wie funktioniert das Internetbesteuerungsverfahren?",
  ])("recognizes a productive German Fachkompositum: %s", (question) => {
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      searchQuery: question,
      requiredTools: ["search_laws"],
    });
  });

  it.each([
    "Kann ich einen unbekannten Aufwand abziehen?",
    "Muss ich einen unbekannten Vorteil versteuern?",
    "Kann ich einen neuen Anspruch geltend machen?",
    "Wird dieser Vorteil gesondert festgesetzt?",
    "Muss ich das Formular einreichen?",
    "Sind die Nachweise aufzubewahren?",
  ])("recognizes a concrete tax or compliance predicate: %s", (question) => {
    expect(createRetrievalGate([{ role: "user", content: question }])).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      requiredTools: ["search_laws"],
    });
  });

  it.each([
    "Wie hoch ist der Verkehrsabsetzbetrag?",
    "Kann ich die Kosten für mein Arbeitszimmer geltend machen?",
    "Muss eine Tagesmutter Betriebsausgaben versteuern?",
    "Kann ich die Kosten einer Steuer-App als Werbungskosten absetzen?",
    "Ist dieser Aufwand abzugsfähig?",
    "Wie lange läuft die Verjährungsfrist?",
    "Wie beantworte ich einen Vorhalt?",
  ])("recognizes varied tax questions without relying on one named example: %s", (question) => {
    expect(createRetrievalGate([{ role: "user", content: question }])).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
    });
  });

  it("uses previous user context for a fragmentary year follow-up", () => {
    const state = createRetrievalGate([
      { role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag?" },
      { role: "assistant", content: "Dazu liegt eine Antwort vor." },
      { role: "user", content: "Und für 2024?" },
    ]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      classificationReason: "contextual_follow_up",
      latestQuestion: "Und für 2024?",
      contextQuestions: [
        "Wie hoch ist der Unterhaltsabsetzbetrag?",
        "Und für 2024?",
      ],
    });
    expect(state.searchQuery).toBe(
      "Ausgangsfrage: Wie hoch ist der Unterhaltsabsetzbetrag?\n"
      + "Aktuelle Folgefrage: Und für 2024?",
    );
  });

  it.each([
    "Warum?",
    "Wieso?",
    "Welche Voraussetzungen?",
    "Was bedeutet das konkret?",
  ])("inherits the previous Fachfrage for a context-dependent follow-up: %s", (followUp) => {
    const rootQuestion = "Kann eine Tagesmutter Werbungskosten geltend machen?";
    const state = createRetrievalGate([
      { role: "user", content: rootQuestion },
      { role: "assistant", content: "Dazu liegt eine Antwort vor." },
      { role: "user", content: followUp },
    ]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "contextual_follow_up",
      latestQuestion: followUp,
      contextQuestions: [rootQuestion, followUp],
      requiredTools: ["search_laws"],
    });
    expect(state.searchQuery).toBe(
      `Ausgangsfrage: ${rootQuestion}\nAktuelle Folgefrage: ${followUp}`,
    );
  });

  it("resolves a fragment before its own direct legal signal can discard the antecedent", () => {
    const state = createRetrievalGate([
      { role: "user", content: "Welche Werbungskostenregel gilt bei einem Drittstaat?" },
      { role: "assistant", content: "Bisherige Antwort." },
      { role: "user", content: "Und gilt das beim UAB?" },
    ]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      classificationReason: "contextual_follow_up",
      contextQuestions: [
        "Welche Werbungskostenregel gilt bei einem Drittstaat?",
        "Und gilt das beim UAB?",
      ],
    });
    expect(state.searchQuery).toContain("Drittstaat");
    expect(state.searchQuery).toContain("UAB");
  });

  it("allows a previous fail-safe default-domain question to be the context root", () => {
    const state = createRetrievalGate([
      { role: "user", content: "Welche Nachweise müssen aufbewahrt werden?" },
      { role: "assistant", content: "Bisherige Antwort." },
      { role: "user", content: "Und für 2024?" },
    ]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      classificationReason: "contextual_follow_up",
      contextQuestions: [
        "Welche Nachweise müssen aufbewahrt werden?",
        "Und für 2024?",
      ],
    });
  });

  it("retains a short chain of user follow-ups but not assistant claims", () => {
    const state = createRetrievalGate([
      { role: "user", content: "Kann ich Werbungskosten geltend machen?" },
      { role: "assistant", content: "Erfundene Assistentenbehauptung darf nicht in die Query." },
      { role: "user", content: "Auch für 2023?" },
      { role: "assistant", content: "Weitere Antwort." },
      { role: "user", content: "Und gilt das weiterhin?" },
    ]);

    expect(state.contextQuestions).toEqual([
      "Kann ich Werbungskosten geltend machen?",
      "Auch für 2023?",
      "Und gilt das weiterhin?",
    ]);
    expect(state.searchQuery).not.toContain("Erfundene Assistentenbehauptung");
    expect(state.searchQuery).toContain("Aktuelle Folgefrage: Und gilt das weiterhin?");
  });

  it("does not reactivate an old legal topic across an explicit topic change", () => {
    const state = createRetrievalGate([
      { role: "user", content: "Wie hoch ist der UAB?" },
      { role: "assistant", content: "Antwort." },
      { role: "user", content: "Wie funktioniert Fredrun?" },
      { role: "assistant", content: "Andere Antwort." },
      { role: "user", content: "Und für 2024?" },
    ]);

    expect(state).toMatchObject({
      kind: "non_fachfrage",
      phase: "ready_to_finalize",
      latestQuestion: "Und für 2024?",
    });
    expect(state.searchQuery).not.toContain("UAB");
  });

  it.each([
    "Wie funktioniert Zellatmung?",
    "Was ist Photosynthese?",
    "Wer verfasste Die Verwandlung?",
    "Erkläre mir die Plattentektonik.",
    "Schreibe ein Gedicht über den Sommer.",
    "Übersetze Guten Morgen ins Englische.",
    "Gib mir ein Rezept für Kürbissuppe.",
    "Was ist Impressionismus?",
    "Wer war Napoleon?",
    "Erkläre Vulkanismus.",
    "Was ist künstliche Intelligenz?",
    "Berechne 2+2.",
    "Wer war Mozart?",
  ])("keeps a general-intent root as a context boundary: %s", (rootQuestion) => {
    const state = createRetrievalGate([
      { role: "user", content: rootQuestion },
      { role: "assistant", content: "Allgemeine Antwort." },
      { role: "user", content: "Warum?" },
    ]);

    expect(state).toMatchObject({
      kind: "non_fachfrage",
      phase: "ready_to_finalize",
      latestQuestion: "Warum?",
      searchQuery: "Warum?",
      requiredTools: [],
    });
  });

  it("inherits an unknown normative root for a short follow-up", () => {
    const rootQuestion = "Wie ist diese neuartige Fallkonstellation zu behandeln?";
    const state = createRetrievalGate([
      { role: "user", content: rootQuestion },
      { role: "assistant", content: "Bisherige Antwort." },
      { role: "user", content: "Warum?" },
    ]);

    expect(state).toMatchObject({
      kind: "fachfrage",
      phase: "law_search_required",
      classificationReason: "contextual_follow_up",
      contextQuestions: [rootQuestion, "Warum?"],
      requiredTools: ["search_laws"],
    });
    expect(state.searchQuery).toBe(
      `Ausgangsfrage: ${rootQuestion}\nAktuelle Folgefrage: Warum?`,
    );
  });

  it("does not inherit a stale Fachfrage for a standalone acknowledgement", () => {
    const state = createRetrievalGate([
      { role: "user", content: "Welche Werbungskosten kann ich absetzen?" },
      { role: "assistant", content: "Antwort." },
      { role: "user", content: "Danke!" },
    ]);

    expect(state.kind).toBe("non_fachfrage");
    expect(state.phase).toBe("ready_to_finalize");
  });

  it("does not guess a legal topic for a context-free fragment", () => {
    const state = createRetrievalGate([{ role: "user", content: "Und für 2024?" }]);

    expect(state.kind).toBe("non_fachfrage");
    expect(state.phase).toBe("ready_to_finalize");
  });
  it.each([
    "Warum?",
    "Wieso?",
    "Welche Voraussetzungen?",
    "Was bedeutet das konkret?",
  ])("does not invent a Fachkontext for a standalone context-dependent question: %s", (question) => {
    const state = createRetrievalGate([{ role: "user", content: question }]);

    expect(state).toMatchObject({
      kind: "non_fachfrage",
      phase: "ready_to_finalize",
      latestQuestion: question,
      searchQuery: question,
      requiredTools: [],
    });
  });
});

describe("retrieval gate ordered workflow", () => {
  it("blocks every other tool until search_laws succeeds", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Welche Werbungskosten sind möglich?",
    }]);

    expect(evaluateRetrievalToolCall(initial, "search_bfg")).toMatchObject({
      allowed: false,
      code: "law_search_must_run_first",
    });
    expect(evaluateRetrievalToolCall(initial, "search_laws")).toEqual({ allowed: true });

    const failed = recordRetrievalToolResult(initial, {
      toolName: "search_laws",
      success: false,
    });
    expect(failed).toMatchObject({ phase: "law_search_required", lawSearchAttempts: 1 });
    expect(evaluateRetrievalFinalization(failed).allowed).toBe(false);
    expect(requiredRetrievalAction(failed)?.toolName).toBe("search_laws");

    const completed = recordRetrievalToolResult(failed, {
      toolName: "search_laws",
      success: true,
    });
    expect(completed).toMatchObject({
      phase: "ready_to_finalize",
      completedTools: ["search_laws"],
      lawSearchAttempts: 2,
    });
    expect(evaluateRetrievalFinalization(completed)).toEqual({ allowed: true });
    expect(requiredRetrievalAction(completed)).toBeUndefined();
  });

  it("requires an explicitly requested BFG search after laws", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Welche BFG-Rechtsprechung gibt es zu Werbungskosten?",
    }]);
    expect(initial.requiredTools).toEqual(["search_laws", "search_bfg"]);

    const afterLaws = recordRetrievalToolResult(initial, {
      toolName: "search_laws",
      success: true,
    });
    expect(afterLaws.phase).toBe("law_search_completed");
    expect(requiredRetrievalAction(afterLaws)).toEqual({
      toolName: "search_bfg",
      arguments: { query: initial.searchQuery },
    });
    expect(evaluateRetrievalFinalization(afterLaws)).toMatchObject({
      allowed: false,
      code: "required_retrieval_steps_not_completed",
    });
    expect(evaluateRetrievalToolCall(afterLaws, "search_work_aids")).toMatchObject({
      allowed: false,
      code: "required_retrieval_step_pending",
    });

    const completed = recordRetrievalToolResult(afterLaws, {
      toolName: "search_bfg",
      success: true,
    });
    expect(completed).toMatchObject({
      phase: "ready_to_finalize",
      completedTools: ["search_laws", "search_bfg"],
    });
  });

  it("routes a generic request for an einschlägige Entscheidung to BFG after laws", () => {
    const state = createRetrievalGate([{
      role: "user",
      content: "Gibt es eine einschlägige Entscheidung zu Werbungskosten?",
    }]);

    expect(state.requiredTools).toEqual(["search_laws", "search_bfg"]);
  });

  it("requires Win-ANV and FEXklusiv together and in order", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Was sagen Win-ANV und FEXklusiv zu Werbungskosten?",
    }]);
    expect(initial.requiredTools).toEqual([
      "search_laws",
      "search_win_anv",
      "search_fexklusiv",
    ]);

    const afterLaws = recordRetrievalToolResult(initial, { toolName: "search_laws", success: true });
    expect(requiredRetrievalAction(afterLaws)?.toolName).toBe("search_win_anv");
    expect(evaluateRetrievalToolCall(afterLaws, "search_fexklusiv")).toMatchObject({
      allowed: false,
      code: "required_retrieval_step_pending",
    });

    const afterWin = recordRetrievalToolResult(afterLaws, {
      toolName: "search_win_anv",
      success: true,
    });
    expect(requiredRetrievalAction(afterWin)?.toolName).toBe("search_fexklusiv");

    const failedFex = recordRetrievalToolResult(afterWin, {
      toolName: "search_fexklusiv",
      success: false,
    });
    expect(requiredRetrievalAction(failedFex)?.toolName).toBe("search_fexklusiv");
    expect(evaluateRetrievalFinalization(failedFex).allowed).toBe(false);

    const completed = recordRetrievalToolResult(failedFex, {
      toolName: "search_fexklusiv",
      success: true,
    });
    expect(completed.phase).toBe("ready_to_finalize");
  });

  it("requires work aids after laws when they are explicitly named", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Welche Arbeitsbehelfe gibt es zur Arbeitnehmerveranlagung?",
    }]);
    expect(initial.requiredTools).toEqual(["search_laws", "search_work_aids"]);

    const afterLaws = recordRetrievalToolResult(initial, { toolName: "search_laws", success: true });
    expect(requiredRetrievalAction(afterLaws)?.toolName).toBe("search_work_aids");
  });

  it("combines all explicitly named mandatory sources in a stable order", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Vergleiche BFG, Win ANV, FEXklusiv und Arbeitsbehelfe zu Werbungskosten.",
    }]);

    expect(initial.requiredTools).toEqual([
      "search_laws",
      "search_bfg",
      "search_win_anv",
      "search_fexklusiv",
      "search_work_aids",
    ]);
  });

  it("does not advance on an out-of-order successful result", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Welche BFG-Rechtsprechung gilt?",
    }]);
    const outOfOrder = recordRetrievalToolResult(initial, {
      toolName: "search_bfg",
      success: true,
    });

    expect(outOfOrder.completedTools).toEqual([]);
    expect(requiredRetrievalAction(outOfOrder)?.toolName).toBe("search_laws");
  });

  it("does not regress after every mandatory search has succeeded", () => {
    const initial = createRetrievalGate([{
      role: "user",
      content: "Was regelt § 16 EStG?",
    }]);
    const completed = recordRetrievalToolResult(initial, {
      toolName: "search_laws",
      success: true,
    });
    const laterFailure = recordRetrievalToolResult(completed, {
      toolName: "search_laws",
      success: false,
    });

    expect(laterFailure).toMatchObject({
      phase: "ready_to_finalize",
      completedTools: ["search_laws"],
      lawSearchAttempts: 2,
    });
    expect(evaluateRetrievalFinalization(laterFailure)).toEqual({ allowed: true });
  });
});
