import { describe, expect, it } from "vitest";

import {
  buildValidatedResearchPlan,
  classifyResearchPlanInput,
  classifyResearchScope,
  extractReferenceYears,
  validateResearchPlan,
  type ValidatedResearchPlan,
} from "./agent-research-plan";

describe("conservative research scope", () => {
  it.each([
    ["Hallo Fred!", "smalltalk"],
    ["Wie wird das Wetter morgen in Wien?", "out_of_scope"],
    ["Was ist die Hauptstadt von Frankreich?", "out_of_scope"],
    ["Wie kann ich in Findog ein Bild hochladen?", "out_of_scope"],
    ["Kann eine Tagesmutter Werbungskosten geltend machen?", "legal"],
    ["Welche Stelle ist intern für diese Aktenart zuständig?", "internal"],
    ["Kannst du das bitte erklären?", "uncertain"],
  ] as const)("classifies %s as %s", (question, expectedScope) => {
    expect(classifyResearchScope(question).scope).toBe(expectedScope);
  });

  it.each([
    ["Hallo Fred!", "smalltalk"],
    ["Wie wird das Wetter morgen in Wien?", "out_of_scope"],
    ["Was ist die Hauptstadt von Frankreich?", "out_of_scope"],
    ["Wie kann ich in Findog ein Bild hochladen?", "out_of_scope"],
  ] as const)("does not build a legal research plan for %s", (question, expectedScope) => {
    const plan = buildValidatedResearchPlan({
      question,
      stichtag: "2026-07-16",
      requiresLegalAssessment: true,
      domain: "legal",
    });

    expect(plan).toMatchObject({
      mode: "no_research",
      scope: expectedScope,
      domain: null,
      phases: [],
    });
  });

  it("keeps an unclassified request out of the legal default", () => {
    const plan = buildValidatedResearchPlan({
      question: "Kannst du das bitte erklären?",
      stichtag: "2026-07-16",
      requiresLegalAssessment: true,
      domain: "legal",
    });

    expect(plan).toMatchObject({
      mode: "clarification_required",
      scope: "uncertain",
      domain: null,
      phases: [],
    });
  });

  it("infers legal and internal primary routing without a legal default", () => {
    const legal = buildValidatedResearchPlan({
      question: "Kann eine Tagesmutter Werbungskosten geltend machen?",
      stichtag: "2026-07-16",
    });
    const internal = buildValidatedResearchPlan({
      question: "Welche Stelle ist intern für diese Aktenart zuständig?",
      stichtag: "2026-07-16",
    });

    expect(legal).toMatchObject({
      scope: "legal",
      domain: "legal",
      phases: [expect.objectContaining({ kind: "primary_law" })],
    });
    expect(internal).toMatchObject({
      scope: "internal",
      domain: "internal",
      phases: [expect.objectContaining({ kind: "primary_internal" })],
    });
  });
});

describe("research-plan classification", () => {
  it("uses the amount short path only for a pure amount question with one explicit year", () => {
    const classification = classifyResearchPlanInput({
      question: "Wie hoch ist der UAB 2024?",
      stichtag: "2026-07-16",
    });

    expect(classification).toMatchObject({
      mode: "simple_amount",
      referenceYears: ["2024"],
      explicitBfgRequest: false,
    });
  });

  it("does not silently assume the current year for an undated amount question", () => {
    const classification = classifyResearchPlanInput({
      question: "Wie hoch ist der Verkehrsabsetzbetrag?",
      stichtag: "2026-07-16",
    });

    expect(classification.mode).toBe("clarification_required");
    expect(classification.reason).toContain("ausdrücklich genanntes Jahr");
  });

  it("routes legal assessment, calculations, and multi-year requests through the general path", () => {
    expect(classifyResearchPlanInput({
      question: "Welche Voraussetzungen gelten 2024 für den AVAB?",
      stichtag: "2026-07-16",
    }).mode).toBe("general");
    expect(classifyResearchPlanInput({
      question: "Wie hoch ist mein Absetzbetrag 2024?",
      stichtag: "2026-07-16",
    }).mode).toBe("general");
    expect(classifyResearchPlanInput({
      question: "Wie hoch ist der Unterhaltsabsetzbetrag 2019 und 2024?",
      stichtag: "2026-07-16",
    }).mode).toBe("general");
  });

  it("extracts unique reference years without reordering the question", () => {
    expect(extractReferenceYears("2024, danach 2022 und nochmals 2024")).toEqual(["2024", "2022"]);
  });
});

describe("validated research plans", () => {
  it("builds a single-source amount plan with a complete FAQ-entry read", () => {
    const plan = buildValidatedResearchPlan({
      question: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?",
      stichtag: "2026-07-16",
    });

    expect(plan.mode).toBe("simple_amount");
    expect(plan.stichtag).toBe("2024-12-31");
    expect(plan.bfg.included).toBe(false);
    expect(plan.phases).toEqual([expect.objectContaining({
      kind: "amount_lookup",
      required: true,
      sourceKeys: ["BETRAGSTABELLE"],
      evidenceReadPolicy: "full_entry_required",
    })]);
  });

  it("starts a general legal question with laws and all contained guidelines", () => {
    const plan = buildValidatedResearchPlan({
      question: "Kann eine Tagesmutter Werbungskosten geltend machen?",
      stichtag: "2026-07-16",
      supplementalSources: ["WIN_ANV", "FEXKLUSIV"],
    });

    expect(plan.mode).toBe("general");
    expect(plan.phases[0]).toMatchObject({
      kind: "primary_law",
      required: true,
      sourceKeys: ["GESETZE"],
      evidenceReadPolicy: "full_text_required",
    });
    expect(plan.phases[1]).toMatchObject({
      kind: "supplementary_sources",
      required: false,
      sourceKeys: ["WIN_ANV", "FEXKLUSIV"],
    });
  });

  it("does not add BFG unless it is explicitly requested or materially relevant", () => {
    const ordinary = buildValidatedResearchPlan({
      question: "Kann eine Tagesmutter Werbungskosten geltend machen?",
      stichtag: "2026-07-16",
    });
    const relevant = buildValidatedResearchPlan({
      question: "Kann eine Tagesmutter Werbungskosten geltend machen?",
      stichtag: "2026-07-16",
      bfgMateriallyRelevant: true,
    });
    const explicit = buildValidatedResearchPlan({
      question: "Welche BFG-Entscheidungen behandeln Werbungskosten einer Tagesmutter?",
      stichtag: "2026-07-16",
    });

    expect(ordinary.phases.some((item) => item.kind === "bfg_case_law")).toBe(false);
    expect(relevant.phases.find((item) => item.kind === "bfg_case_law")).toMatchObject({
      required: false,
      sourceKeys: ["BFG"],
    });
    expect(explicit.phases.find((item) => item.kind === "bfg_case_law")).toMatchObject({
      required: true,
      sourceKeys: ["BFG"],
    });
  });

  it("routes internal administration questions to internal documents without a law phase", () => {
    const plan = buildValidatedResearchPlan({
      question: "Welche Stelle ist intern für diese Aktenart zuständig?",
      stichtag: "2026-07-16",
      domain: "internal",
    });

    expect(plan.phases).toEqual([expect.objectContaining({
      kind: "primary_internal",
      sourceKeys: ["ARBEITSBEHELFE"],
      required: true,
    })]);
  });

  it("rejects invalid dates and malformed plans", () => {
    expect(() => buildValidatedResearchPlan({
      question: "Kann eine Tagesmutter Werbungskosten geltend machen?",
      stichtag: "2026-02-30",
    })).toThrow("valid ISO date");

    const valid = buildValidatedResearchPlan({
      question: "Kann eine Tagesmutter Werbungskosten geltend machen?",
      stichtag: "2026-07-16",
    });
    const malformed: ValidatedResearchPlan = {
      ...valid,
      bfg: { explicitlyRequested: false, materiallyRelevant: false, included: true },
      phases: [
        ...valid.phases,
        {
          id: "unjustified-bfg",
          order: 1,
          kind: "bfg_case_law",
          required: false,
          sourceKeys: ["BFG"],
          query: valid.question,
          dependsOn: ["primary-law"],
          evidenceReadPolicy: "full_text_required",
        },
      ],
    };

    expect(validateResearchPlan(malformed)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "unjustified_bfg_phase" })]),
    });
  });
});
