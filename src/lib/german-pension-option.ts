/**
 * German pension option (Optionsmöglichkeit in Deutschland) quick-check.
 *
 * Determines whether the current Austrian PVA/SVA pension amount after the
 * fixed German pension exemption falls below the German basic allowance.
 *
 * This is a simplified Schnellcheck only — not a complete § 1 Abs. 3 EStG /
 * 90-% test.
 */

// German pension exemption rate by first full pension year.
// Maintained legal lookup data (post-Wachstumschancengesetz).
export const GERMAN_PENSION_EXEMPTION_RATES: Record<number, number> = {
  2005: 0.50, 2006: 0.48, 2007: 0.46, 2008: 0.44,
  2009: 0.42, 2010: 0.40, 2011: 0.38, 2012: 0.36,
  2013: 0.34, 2014: 0.32, 2015: 0.30, 2016: 0.28,
  2017: 0.26, 2018: 0.24, 2019: 0.22, 2020: 0.20,
  2021: 0.19, 2022: 0.18, 2023: 0.175, 2024: 0.17,
  2025: 0.165, 2026: 0.16, 2027: 0.155, 2028: 0.15,
};

// German individual basic allowance by current year (Stand 01.07.2026).
export const GERMAN_BASIC_ALLOWANCES: Record<number, number> = {
  2005: 7664, 2006: 7664, 2007: 7664, 2008: 7664,
  2009: 7834, 2010: 8004, 2011: 8004, 2012: 8004,
  2013: 8130, 2014: 8354, 2015: 8472, 2016: 8652,
  2017: 8820, 2018: 9000, 2019: 9168, 2020: 9408,
  2021: 9744, 2022: 10347, 2023: 10908, 2024: 11784,
  2025: 12096, 2026: 12348,
};

export type GermanPensionOptionInput = {
  currentYear: number;
  firstFullPensionYear: number;
  firstFullGrossPension: number;
  currentAnnualGrossPension: number;
};

export type GermanPensionOptionUnavailable = {
  available: false;
  unavailableReason: string;
};

export type GermanPensionOptionAvailable = {
  available: true;
  exemptionRate: number;
  fixedPensionExemptionEur: number;
  progressionIncomeEur: number;
  basicAllowanceEur: number;
  differenceToBasicAllowanceEur: number;
  optionPossible: boolean;
};

export type GermanPensionOptionResult =
  | GermanPensionOptionAvailable
  | GermanPensionOptionUnavailable;

const EURO_FORMATTER = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Look up the German pension exemption rate for a given first full pension year.
 * Returns null if the year is not in the lookup table.
 */
export function lookupExemptionRate(year: number): number | null {
  const rate = GERMAN_PENSION_EXEMPTION_RATES[year];
  return rate !== undefined ? rate : null;
}

/**
 * Look up the German basic allowance for a given current year.
 * Returns null if the year is not in the lookup table.
 */
export function lookupBasicAllowance(year: number): number | null {
  const allowance = GERMAN_BASIC_ALLOWANCES[year];
  return allowance !== undefined ? allowance : null;
}

/**
 * Round a monetary value to two decimal places to avoid floating-point drift.
 */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate the German pension option quick-check result.
 * Returns an unavailable result when either lookup year is missing
 * or when the first full pension year is after the current year.
 */
export function calculateGermanPensionOption(
  input: GermanPensionOptionInput,
): GermanPensionOptionResult {
  if (input.firstFullPensionYear > input.currentYear) {
    return {
      available: false,
      unavailableReason:
        `Das erste volle Bezugsjahr (${input.firstFullPensionYear}) darf nicht nach dem aktuellen Jahr (${input.currentYear}) liegen.`,
    };
  }

  const exemptionRate = lookupExemptionRate(input.firstFullPensionYear);
  if (exemptionRate === null) {
    return {
      available: false,
      unavailableReason:
        `Für das erste volle Bezugsjahr ${input.firstFullPensionYear} ist kein Rentenfreibetragssatz hinterlegt.`,
    };
  }

  const basicAllowance = lookupBasicAllowance(input.currentYear);
  if (basicAllowance === null) {
    return {
      available: false,
      unavailableReason:
        `Für das Jahr ${input.currentYear} ist kein Grundfreibetrag hinterlegt.`,
    };
  }

  const fixedPensionExemptionEur = roundCents(
    input.firstFullGrossPension * exemptionRate,
  );
  const progressionIncomeEur = roundCents(
    input.currentAnnualGrossPension - fixedPensionExemptionEur,
  );
  const differenceToBasicAllowanceEur = roundCents(
    progressionIncomeEur - basicAllowance,
  );
  const optionPossible = differenceToBasicAllowanceEur < 0;

  return {
    available: true,
    exemptionRate,
    fixedPensionExemptionEur,
    progressionIncomeEur,
    basicAllowanceEur: basicAllowance,
    differenceToBasicAllowanceEur,
    optionPossible,
  };
}

/**
 * Parse a German-notation amount string to a number.
 * Accepts formats like "1.308,70", "1308,70 €", "12000", "12.000".
 * Returns null for empty or invalid input.
 */
export function parseGermanPensionAmount(value: string): number | null {
  const compact = value.trim().replace(/[\s\u00a0€]/g, "");
  if (!compact) {
    return null;
  }

  let normalized: string;
  if (compact.includes(",")) {
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(compact)) {
      return null;
    }
    normalized = compact.replaceAll(".", "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(compact)) {
    normalized = compact;
  } else if (/^(?:\d{1,3}(?:\.\d{3})+|\d+)$/.test(compact)) {
    normalized = compact.replaceAll(".", "");
  } else {
    return null;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/**
 * Format a number as a German-notation euro string.
 * Uses '.' as thousands separator (consistent with the existing app convention).
 */
export function formatGermanPensionEuro(value: number): string {
  const formatted = EURO_FORMATTER.format(value);
  return `${formatted.replace(/[\s\u00a0\u202f]/g, ".")} €`;
}
