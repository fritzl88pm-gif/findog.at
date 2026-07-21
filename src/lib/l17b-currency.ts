export type L17bCurrencyEntry = {
  country: string;
  currencyCode: string;
  currencyName: string;
  steuerwertRaw: string;
  steuerwert: number;
};

export type L17bYearDef = {
  entries: ReadonlyArray<L17bCurrencyEntry>;
  sourceNote: string;
};

export const L17B_FREQUENT_CURRENCY_CODES = ["HUF", "PLN", "CZK", "CHF", "RON"] as const;

const COUNTRY_CODE_BY_CURRENCY: Readonly<Record<string, string>> = {
  AUD: "AU",
  BGN: "BG",
  BRL: "BR",
  CAD: "CA",
  CHF: "CH",
  CNY: "CN",
  CZK: "CZ",
  DKK: "DK",
  GBP: "GB",
  HKD: "HK",
  HRK: "HR",
  HUF: "HU",
  IDR: "ID",
  ILS: "IL",
  INR: "IN",
  ISK: "IS",
  JPY: "JP",
  KRW: "KR",
  MXN: "MX",
  MYR: "MY",
  NOK: "NO",
  NZD: "NZ",
  PHP: "PH",
  PLN: "PL",
  RON: "RO",
  RUB: "RU",
  SEK: "SE",
  SGD: "SG",
  THB: "TH",
  TRY: "TR",
  USD: "US",
  ZAR: "ZA",
};

export function getL17bCountryCode(currencyCode: string): string | undefined {
  return COUNTRY_CODE_BY_CURRENCY[currencyCode];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function parseCommaDecimal(raw: string): number {
  const normalized = raw.replace(",", ".");
  return Number.parseFloat(normalized);
}

function buildEntry(
  country: string,
  currencyCode: string,
  currencyName: string,
  steuerwertRaw: string,
): L17bCurrencyEntry {
  return {
    country,
    currencyCode,
    currencyName,
    steuerwertRaw,
    steuerwert: parseCommaDecimal(steuerwertRaw),
  };
}

function buildLookup(
  entries: ReadonlyArray<L17bCurrencyEntry>,
): ReadonlyMap<string, L17bCurrencyEntry> {
  return new Map(entries.map((e) => [e.currencyCode, e]));
}

// ── Canonical country / currency metadata ───────────────────────────────────
//
// 2025 entries provide the canonical names for the 30 standard currencies.
// HRK / RUB metadata is added separately for 2020–2022.

const STANDARD_COUNTRY_META: Record<string, [string, string]> = {
  AUD: ["Australien", "Australischer Dollar"],
  BGN: ["Bulgarien", "Bulgarischer Lew"],
  BRL: ["Brasilien", "Real"],
  CAD: ["Kanada", "Kanadischer Dollar"],
  CHF: ["Schweiz", "Schweizer Franken"],
  CNY: ["China", "Renminbi Yuan"],
  CZK: ["Tschechische Republik", "Tschechische Krone"],
  DKK: ["Dänemark", "Dänische Krone"],
  GBP: ["Vereinigtes Königreich", "Pfund Sterling"],
  HKD: ["Hongkong", "Hongkong-Dollar"],
  HUF: ["Ungarn", "Forint"],
  IDR: ["Indonesien", "Rupiah"],
  ILS: ["Israel", "Neuer Schekel"],
  INR: ["Indien", "Indische Rupie"],
  ISK: ["Island", "Isländische Krone"],
  JPY: ["Japan", "Yen"],
  KRW: ["Korea, Repulik", "Won"],
  MXN: ["Mexiko", "Mexikanischer Peso"],
  MYR: ["Malaysia", "Ringgit"],
  NOK: ["Norwegen", "Norwegische Krone"],
  NZD: ["Neuseeland", "Neuseeland Dollar"],
  PHP: ["Philippinen", "Philippinischer Peso"],
  PLN: ["Polen", "Zloty"],
  RON: ["Rumänien", "Neuer Rumänischer Leu"],
  SEK: ["Schweden", "Schwedische Krone"],
  SGD: ["Singapur", "Singapur-Dollar"],
  THB: ["Thailand", "Baht"],
  TRY: ["Türkei", "Neue Türkische Lira"],
  USD: ["USA", "US-Dollar"],
  ZAR: ["Südafrika", "Südafrikanischer Rand"],
  HRK: ["Kroatien", "Kuna"],
  RUB: ["Russische Föderation", "Russischer Rubel"],
};

// ── Year-specific raw Steuerwert values ────────────────────────────────────

type YearRawRates = Record<string, string>;

const RAW_RATES_2020: YearRawRates = {
  AUD: "0,595202", BGN: "0,503630", BRL: "0,167111", CAD: "0,643791",
  CHF: "0,920131", CNY: "0,125084", CZK: "0,037233", DKK: "0,132140",
  GBP: "1,107115", HKD: "0,111190", HRK: "0,130664", HUF: "0,002804",
  IDR: "0,000059", ILS: "0,250904", INR: "0,011638", ISK: "0,006372",
  JPY: "0,008084", KRW: "0,000732", MXN: "0,040172", MYR: "0,205384",
  NOK: "0,091860", NZD: "0,560902", PHP: "0,017398", PLN: "0,221697",
  RON: "0,203584", RUB: "0,011907", SEK: "0,093946", SGD: "0,625715",
  THB: "0,027585", TRY: "0,122289", USD: "0,862371", ZAR: "0,052490",
};

const RAW_RATES_2021: YearRawRates = {
  AUD: "0,625437", BGN: "0,503630", BRL: "0,154440", CAD: "0,664373",
  CHF: "0,911109", CNY: "0,129126", CZK: "0,038417", DKK: "0,132446",
  GBP: "1,145882", HKD: "0,107144", HRK: "0,130838", HUF: "0,002747",
  IDR: "0,000058", ILS: "0,257799", INR: "0,011265", ISK: "0,006560",
  JPY: "0,007584", KRW: "0,000727", MXN: "0,041067", MYR: "0,200959",
  NOK: "0,096917", NZD: "0,588974", PHP: "0,016896", PLN: "0,215763",
  RON: "0,200142", RUB: "0,011302", SEK: "0,097078", SGD: "0,619848",
  THB: "0,026033", TRY: "0,093699", USD: "0,832840", ZAR: "0,056361",
};

const RAW_RATES_2022: YearRawRates = {
  AUD: "0,649436", BGN: "0,503630", BRL: "0,181070", CAD: "0,719241",
  CHF: "0,980392", CNY: "0,139148", CZK: "0,040096", DKK: "0,132400",
  GBP: "1,155073", HKD: "0,119465", HRK: "0,130725", HUF: "0,002517",
  IDR: "0,000063", ILS: "0,278682", INR: "0,011912", ISK: "0,006925",
  JPY: "0,007136", KRW: "0,000725", MXN: "0,046491", MYR: "0,212840",
  NOK: "0,097500", NZD: "0,594018", PHP: "0,017186", PLN: "0,210196",
  RON: "0,199744", RUB: "0,011143", SEK: "0,092666", SGD: "0,678749",
  THB: "0,026726", TRY: "0,056581", USD: "0,935423", ZAR: "0,057239",
};

const RAW_RATES_2023: YearRawRates = {
  AUD: "0,604740", BGN: "0,503630", BRL: "0,182374", CAD: "0,674889",
  CHF: "1,013583", CNY: "0,128590", CZK: "0,041035", DKK: "0,132199",
  GBP: "1,132457", HKD: "0,116361", HUF: "0,002580", IDR: "0,000060",
  ILS: "0,246991", INR: "0,011030", ISK: "0,006605", JPY: "0,006481",
  KRW: "0,000697", MXN: "0,051348", MYR: "0,199716", NOK: "0,086216",
  NZD: "0,558960", PHP: "0,016372", PLN: "0,216865", RON: "0,199123",
  SEK: "0,085810", SGD: "0,678235", THB: "0,026175", TRY: "0,038238",
  USD: "0,910941", ZAR: "0,049361",
};

const RAW_RATES_2024: YearRawRates = {
  AUD: "0,600720", BGN: "0,503630", BRL: "0,169003", CAD: "0,664598",
  CHF: "1,034012", CNY: "0,126485", CZK: "0,039212", DKK: "0,132057",
  GBP: "1,163450", HKD: "0,116632", HUF: "0,002492", IDR: "0,000057",
  ILS: "0,245838", INR: "0,010877", ISK: "0,006597", JPY: "0,006012",
  KRW: "0,000668", MXN: "0,049669", MYR: "0,198978", NOK: "0,084702",
  NZD: "0,550895", PHP: "0,015885", PLN: "0,228761", RON: "0,198006",
  SEK: "0,086158", SGD: "0,681284", THB: "0,025798", TRY: "0,027689",
  USD: "0,910015", ZAR: "0,049673",
};

// 2025 data (authoritative – keep exact strings)
const RAW_RATES_2025: YearRawRates = {
  AUD: "0,562279", BGN: "0,503630", BRL: "0,156171", CAD: "0,623931",
  CHF: "1,051227", CNY: "0,121328", CZK: "0,039898", DKK: "0,131977",
  GBP: "1,149640", HKD: "0,111800", HUF: "0,002476", IDR: "0,000053",
  ILS: "0,253038", INR: "0,009998", ISK: "0,006809", JPY: "0,005827",
  KRW: "0,000614", MXN: "0,045453", MYR: "0,203769", NOK: "0,084064",
  NZD: "0,507157", PHP: "0,015159", PLN: "0,232328", RON: "0,195343",
  SEK: "0,089009", SGD: "0,667525", THB: "0,026538", TRY: "0,021979",
  USD: "0,871681", ZAR: "0,048813",
};

// ── Build year definitions ──────────────────────────────────────────────────

function buildYearEntries(
  rates: YearRawRates,
  meta: Record<string, [string, string]>,
): ReadonlyArray<L17bCurrencyEntry> {
  return Object.keys(rates)
    .sort()
    .map((code) => {
      const [country, currencyName] = meta[code];
      return buildEntry(country, code, currencyName, rates[code]);
    });
}

const SOURCE_NOTES: Record<string, string> = {
  "2020": "L 17b-2020, Version vom 05.01.2021",
  "2021": "L 17b-2021, Version vom 05.01.2022",
  "2022": "L 17b-2022, Version vom 13.01.2023",
  "2023": "L 17b-2023, Version vom 05.01.2024",
  "2024": "L 17b-2024, Version vom 08.01.2025",
  "2025": "L 17b-2025, Version vom 28.01.2026",
};

function buildYearDef(year: string, rates: YearRawRates): L17bYearDef {
  return {
    entries: buildYearEntries(rates, STANDARD_COUNTRY_META),
    sourceNote: SOURCE_NOTES[year],
  };
}

const YEAR_DEFS: Record<string, L17bYearDef> = {
  "2020": buildYearDef("2020", RAW_RATES_2020),
  "2021": buildYearDef("2021", RAW_RATES_2021),
  "2022": buildYearDef("2022", RAW_RATES_2022),
  "2023": buildYearDef("2023", RAW_RATES_2023),
  "2024": buildYearDef("2024", RAW_RATES_2024),
  "2025": buildYearDef("2025", RAW_RATES_2025),
};

// Per-year lookup maps
const LOOKUP_BY_YEAR: Record<string, ReadonlyMap<string, L17bCurrencyEntry>> = {};
for (const [year, def] of Object.entries(YEAR_DEFS)) {
  LOOKUP_BY_YEAR[year] = buildLookup(def.entries);
}

// ── Available years ─────────────────────────────────────────────────────────

export const L17B_YEARS: ReadonlyArray<string> = ["2025", "2024", "2023", "2022", "2021", "2020"];

// ── Public helpers ──────────────────────────────────────────────────────────

export function getL17bYearEntries(year: string): ReadonlyArray<L17bCurrencyEntry> | undefined {
  return YEAR_DEFS[year]?.entries;
}

export function lookupL17bEntry(
  year: string,
  currencyCode: string,
): L17bCurrencyEntry | undefined {
  return LOOKUP_BY_YEAR[year]?.get(currencyCode);
}

export function convertL17bCurrency(
  year: string,
  currencyCode: string,
  amount: number,
): number | null {
  const entry = lookupL17bEntry(year, currencyCode);
  if (!entry) {
    return null;
  }
  return amount * entry.steuerwert;
}

export function getL17bSourceNote(year: string): string | undefined {
  return SOURCE_NOTES[year];
}

// ── Formatting / parsing (unchanged from original) ──────────────────────────

const EURO_FORMATTER = new Intl.NumberFormat("de-AT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatL17bEuro(value: number): string {
  return `${EURO_FORMATTER.format(value).replace(/[\s\u00a0\u202f]/g, ".")} €`;
}

export function parseL17bGermanAmount(value: string): number | null {
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

export function formatL17bForeignAmount(value: number, currencyCode: string): string {
  return `${EURO_FORMATTER.format(value).replace(/[\s\u00a0\u202f]/g, ".")} ${currencyCode}`;
}
