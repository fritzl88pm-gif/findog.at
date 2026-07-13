export type L17bCurrencyEntry = {
  country: string;
  currencyCode: string;
  currencyName: string;
  steuerwertRaw: string;
  steuerwert: number;
};

const RAW_DATA: ReadonlyArray<[string, string, string, string]> = [
  ["Australien", "AUD", "Australischer Dollar", "0,562279"],
  ["Bulgarien", "BGN", "Bulgarischer Lew", "0,503630"],
  ["Brasilien", "BRL", "Real", "0,156171"],
  ["Kanada", "CAD", "Kanadischer Dollar", "0,623931"],
  ["Schweiz", "CHF", "Schweizer Franken", "1,051227"],
  ["China", "CNY", "Renminbi Yuan", "0,121328"],
  ["Tschechische Republik", "CZK", "Tschechische Krone", "0,039898"],
  ["Dänemark", "DKK", "Dänische Krone", "0,131977"],
  ["Vereinigtes Königreich", "GBP", "Pfund Sterling", "1,149640"],
  ["Hongkong", "HKD", "Hongkong-Dollar", "0,111800"],
  ["Ungarn", "HUF", "Forint", "0,002476"],
  ["Indonesien", "IDR", "Rupiah", "0,000053"],
  ["Israel", "ILS", "Neuer Schekel", "0,253038"],
  ["Indien", "INR", "Indische Rupie", "0,009998"],
  ["Island", "ISK", "Isländische Krone", "0,006809"],
  ["Japan", "JPY", "Yen", "0,005827"],
  ["Korea, Repulik", "KRW", "Won", "0,000614"],
  ["Mexiko", "MXN", "Mexikanischer Peso", "0,045453"],
  ["Malaysia", "MYR", "Ringgit", "0,203769"],
  ["Norwegen", "NOK", "Norwegische Krone", "0,084064"],
  ["Neuseeland", "NZD", "Neuseeland Dollar", "0,507157"],
  ["Philippinen", "PHP", "Philippinischer Peso", "0,015159"],
  ["Polen", "PLN", "Zloty", "0,232328"],
  ["Rumänien", "RON", "Neuer Rumänischer Leu", "0,195343"],
  ["Schweden", "SEK", "Schwedische Krone", "0,089009"],
  ["Singapur", "SGD", "Singapur-Dollar", "0,667525"],
  ["Thailand", "THB", "Baht", "0,026538"],
  ["Türkei", "TRY", "Neue Türkische Lira", "0,021979"],
  ["USA", "USD", "US-Dollar", "0,871681"],
  ["Südafrika", "ZAR", "Südafrikanischer Rand", "0,048813"],
];

function parseCommaDecimal(raw: string): number {
  const normalized = raw.replace(",", ".");
  return Number.parseFloat(normalized);
}

function buildEntry([country, currencyCode, currencyName, steuerwertRaw]: readonly [string, string, string, string]): L17bCurrencyEntry {
  return {
    country,
    currencyCode,
    currencyName,
    steuerwertRaw,
    steuerwert: parseCommaDecimal(steuerwertRaw),
  };
}

export const L17B_CURRENCY_2025_ENTRIES: ReadonlyArray<L17bCurrencyEntry> =
  RAW_DATA.map(buildEntry);

const LOOKUP_BY_CODE: ReadonlyMap<string, L17bCurrencyEntry> = new Map(
  L17B_CURRENCY_2025_ENTRIES.map((entry) => [entry.currencyCode, entry]),
);

export function lookupL17bEntry(currencyCode: string): L17bCurrencyEntry | undefined {
  return LOOKUP_BY_CODE.get(currencyCode);
}

export function convertL17bCurrency(
  currencyCode: string,
  amount: number,
): number | null {
  const entry = lookupL17bEntry(currencyCode);
  if (!entry) {
    return null;
  }
  return amount * entry.steuerwert;
}

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
