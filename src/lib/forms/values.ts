import { UserVisibleError } from "../errors";

const SALDO_INPUT_PATTERN = /^\d+(?:[,.]\d{1,2})?$/;

export function formatViennaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Vienna",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("day")}.${part("month")}.${part("year")}`;
}

export function normalizeManualSaldo(value: unknown): string {
  if (typeof value !== "string") {
    throw new UserVisibleError("Der Saldo ist ungültig.", 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "— ";
  }
  if (!SALDO_INPUT_PATTERN.test(trimmed)) {
    throw new UserVisibleError(
      "Der Saldo darf nur Ziffern und höchstens zwei Dezimalstellen enthalten.",
      400,
    );
  }

  const [rawInteger = "0", rawFraction = ""] = trimmed.split(/[,.]/, 2);
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = rawFraction.padEnd(2, "0");

  return `${groupedInteger},${fraction} `;
}
