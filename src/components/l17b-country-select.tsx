"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AU,
  BG,
  BR,
  CA,
  CH,
  CN,
  CZ,
  DK,
  GB,
  HK,
  HR,
  HU,
  ID,
  IL,
  IN,
  IS,
  JP,
  KR,
  MX,
  MY,
  NO,
  NZ,
  PH,
  PL,
  RO,
  RU,
  SE,
  SG,
  TH,
  TR,
  US,
  ZA,
} from "country-flag-icons/react/3x2";

import {
  getL17bCountryCode,
  L17B_FREQUENT_CURRENCY_CODES,
  type L17bCurrencyEntry,
} from "@/lib/l17b-currency";

type L17bCountrySelectProps = {
  entries: ReadonlyArray<L17bCurrencyEntry>;
  selectedCode: string;
  onChange: (currencyCode: string) => void;
};

const COUNTRY_FLAGS: Readonly<Record<string, typeof AU>> = {
  AU,
  BG,
  BR,
  CA,
  CH,
  CN,
  CZ,
  DK,
  GB,
  HK,
  HR,
  HU,
  ID,
  IL,
  IN,
  IS,
  JP,
  KR,
  MX,
  MY,
  NO,
  NZ,
  PH,
  PL,
  RO,
  RU,
  SE,
  SG,
  TH,
  TR,
  US,
  ZA,
};

function CountryFlag({ currencyCode }: { currencyCode: string }) {
  const countryCode = getL17bCountryCode(currencyCode);
  const Flag = countryCode ? COUNTRY_FLAGS[countryCode] : undefined;
  return Flag ? <Flag className="l17b-country-flag" aria-hidden="true" /> : null;
}

function entryLabel(entry: L17bCurrencyEntry): string {
  return `${entry.country} (${entry.currencyCode}, ${entry.currencyName})`;
}

export default function L17bCountrySelect({
  entries,
  selectedCode,
  onChange,
}: L17bCountrySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedEntry = entries.find((entry) => entry.currencyCode === selectedCode);
  const frequentCurrencyCodes = useMemo(
    () => new Set<string>(L17B_FREQUENT_CURRENCY_CODES),
    [],
  );
  const frequentEntries = L17B_FREQUENT_CURRENCY_CODES.flatMap((currencyCode) => {
    const entry = entries.find((candidate) => candidate.currencyCode === currencyCode);
    return entry ? [entry] : [];
  });
  const otherEntries = entries.filter((entry) => !frequentCurrencyCodes.has(entry.currencyCode));
  const optionCodes = ["", ...frequentEntries, ...otherEntries].map((entry) =>
    typeof entry === "string" ? entry : entry.currencyCode);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  function focusOption(currencyCode: string): void {
    requestAnimationFrame(() => optionRefs.current.get(currencyCode)?.focus());
  }

  function openAndFocus(preferLast = false): void {
    setIsOpen(true);
    const fallbackCode = preferLast
      ? optionCodes.at(-1) ?? ""
      : frequentEntries[0]?.currencyCode ?? otherEntries[0]?.currencyCode ?? "";
    focusOption(optionCodes.includes(selectedCode) && selectedCode ? selectedCode : fallbackCode);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAndFocus(event.key === "ArrowUp");
    }
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currencyCode: string,
  ): void {
    const currentIndex = optionCodes.indexOf(currencyCode);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + direction + optionCodes.length) % optionCodes.length;
      focusOption(optionCodes[nextIndex]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? optionCodes[0] : optionCodes.at(-1) ?? "");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  function selectCurrency(currencyCode: string): void {
    onChange(currencyCode);
    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function renderOption(entry: L17bCurrencyEntry) {
    const isSelected = entry.currencyCode === selectedCode;
    return (
      <button
        className={`l17b-country-option${isSelected ? " is-selected" : ""}`}
        key={entry.currencyCode}
        type="button"
        role="option"
        aria-selected={isSelected}
        ref={(node) => {
          if (node) optionRefs.current.set(entry.currencyCode, node);
          else optionRefs.current.delete(entry.currencyCode);
        }}
        onClick={() => selectCurrency(entry.currencyCode)}
        onKeyDown={(event) => handleOptionKeyDown(event, entry.currencyCode)}
      >
        <CountryFlag currencyCode={entry.currencyCode} />
        <span>{entryLabel(entry)}</span>
      </button>
    );
  }

  return (
    <div className="l17b-country-picker" ref={rootRef}>
      <button
        className="l17b-country-trigger"
        id="l17b-country-select"
        type="button"
        role="combobox"
        aria-controls="l17b-country-listbox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        ref={triggerRef}
        onClick={() => {
          if (isOpen) setIsOpen(false);
          else openAndFocus();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="l17b-country-trigger-value">
          {selectedEntry ? <CountryFlag currencyCode={selectedEntry.currencyCode} /> : null}
          <span>{selectedEntry ? entryLabel(selectedEntry) : "— Land auswählen —"}</span>
        </span>
        <svg className="l17b-country-chevron" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>

      {isOpen ? (
        <div className="l17b-country-listbox" id="l17b-country-listbox" role="listbox">
          <button
            className={`l17b-country-option is-placeholder${selectedCode ? "" : " is-selected"}`}
            type="button"
            role="option"
            aria-selected={!selectedCode}
            ref={(node) => {
              if (node) optionRefs.current.set("", node);
              else optionRefs.current.delete("");
            }}
            onClick={() => selectCurrency("")}
            onKeyDown={(event) => handleOptionKeyDown(event, "")}
          >
            <span>— Land auswählen —</span>
          </button>

          <div className="l17b-country-group" role="group" aria-labelledby="l17b-frequent-countries">
            <div className="l17b-country-group-label" id="l17b-frequent-countries">
              Häufig verwendet
            </div>
            {frequentEntries.map(renderOption)}
          </div>

          <div className="l17b-country-group" role="group" aria-labelledby="l17b-all-countries">
            <div className="l17b-country-group-label" id="l17b-all-countries">
              Alle Länder
            </div>
            {otherEntries.map(renderOption)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
