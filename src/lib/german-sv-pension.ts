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

export type GermanSvPensionPdfDocument = {
  title: string;
  content: string;
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

function formatGermanSvPercentage(value: number): string {
  return `${(value * 100).toLocaleString("de-AT", {
    maximumFractionDigits: 6,
  })} %`;
}

export function buildGermanSvPensionPdfDocument(
  year: GermanSvPensionYear,
  mode: GermanSvPensionMode,
  amount: number,
): GermanSvPensionPdfDocument {
  const calculation = calculateGermanSvPension(year, mode, amount);
  const inputType = mode === "kv" ? "KV-Beitrag" : "Rentenbrutto / AEOI-KM";
  const kvBasis = mode === "kv"
    ? "Eingabewert (KV-Beitrag)"
    : "Eingabewert (Rentenbrutto / AEOI-KM) × KV-Beitragssatz";
  const subsidyBasis = mode === "kv"
    ? "Österreichischer KV-Beitrag ÷ 2"
    : "Eingabewert (Rentenbrutto / AEOI-KM) × halber Beitragssatz";
  const assessmentBasis = mode === "kv"
    ? "Österreichischer KV-Beitrag ÷ KV-Beitragssatz"
    : "Eingabewert (Rentenbrutto / AEOI-KM)";

  return {
    title: `Berechnungsblatt zur deutschen Sozialversicherungsrente ${year}`,
    content: [
      "## Berechnungsgrundlagen",
      "",
      "| Grundlage | Wert |",
      "| --- | ---: |",
      `| Veranlagungsjahr | ${year} |`,
      `| Eingabeart | ${inputType} |`,
      `| Eingabewert | ${formatGermanSvEuro(amount)} |`,
      `| KV-Beitragssatz (§ 73a ASVG) | ${formatGermanSvRate(year)} |`,
      `| Halber Beitragssatz | ${formatGermanSvPercentage(calculation.halfRate)} |`,
      `| Kz-453-Faktor | ${formatGermanSvPercentage(calculation.simplifiedFactor)} |`,
      "",
      "## Berechnung und Kennzahlen",
      "",
      "| Position | Grundlage | Betrag |",
      "| --- | --- | ---: |",
      `| Österreichischer KV-Beitrag | ${kvBasis} | ${formatGermanSvEuro(calculation.kvBeitrag)} |`,
      `| Deutscher Zuschuss zur Krankenversicherung | ${subsidyBasis} | ${formatGermanSvEuro(calculation.zuschuss)} |`,
      `| Deutscher Jahresbetrag der Rente bzw. KV-Bemessungsgrundlage | ${assessmentBasis} | ${formatGermanSvEuro(calculation.bmgl)} |`,
      `| Kz 453 | KV-Bemessungsgrundlage × Kz-453-Faktor | ${formatGermanSvEuro(calculation.kz453)} |`,
      `| Kz 184 | Österreichischer KV-Beitrag | ${formatGermanSvEuro(calculation.kz184)} |`,
    ].join("\n"),
  };
}
