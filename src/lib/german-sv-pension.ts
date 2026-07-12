export const GERMAN_SV_PENSION_YEARS = [2024, 2025, 2026] as const;

export type GermanSvPensionYear = (typeof GERMAN_SV_PENSION_YEARS)[number];
export type GermanSvPensionMode = "kv" | "rentenbrutto";

type GermanSvPensionRate = {
  rate: number;
  displayPrecision: number;
};

export type GermanSvPensionResult = {
  rate: number;
  halfRate: number;
  simplifiedFactor: number;
  kvBeitrag: number;
  zuschuss: number;
  bmgl: number;
  kz453: number;
  kz184: number;
};

const RATES: Record<GermanSvPensionYear, GermanSvPensionRate> = {
  2024: { rate: 0.051, displayPrecision: 2 },
  2025: { rate: 0.0561395, displayPrecision: 5 },
  2026: { rate: 0.06, displayPrecision: 1 },
};

const EURO_FORMATTER = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function getGermanSvPensionRate(year: GermanSvPensionYear): GermanSvPensionRate {
  return RATES[year];
}

export function calculateGermanSvPension(
  year: GermanSvPensionYear,
  mode: GermanSvPensionMode,
  amount: number,
): GermanSvPensionResult {
  const { rate } = getGermanSvPensionRate(year);
  const halfRate = rate / 2;
  const simplifiedFactor = 1 - halfRate;

  if (mode === "kv") {
    const zuschuss = amount / 2;
    const bmgl = amount / rate;
    return {
      rate,
      halfRate,
      simplifiedFactor,
      kvBeitrag: amount,
      zuschuss,
      bmgl,
      kz453: bmgl * simplifiedFactor,
      kz184: amount,
    };
  }

  const zuschuss = amount * halfRate;
  const austrKV = amount * rate;
  return {
    rate,
    halfRate,
    simplifiedFactor,
    kvBeitrag: austrKV,
    zuschuss,
    bmgl: amount,
    kz453: amount * simplifiedFactor,
    kz184: austrKV,
  };
}

export function parseGermanSvAmount(value: string): number | null {
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

export function formatGermanSvEuro(value: number): string {
  return `${EURO_FORMATTER.format(value).replace(/[\s\u00a0\u202f]/g, ".")} €`;
}

export function formatGermanSvRate(year: GermanSvPensionYear): string {
  const { rate, displayPrecision } = getGermanSvPensionRate(year);
  return `${(rate * 100).toLocaleString("de-AT", {
    minimumFractionDigits: displayPrecision,
    maximumFractionDigits: displayPrecision,
  })} %`;
}
