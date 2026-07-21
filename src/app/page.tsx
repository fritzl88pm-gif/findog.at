"use client";

import { Fragment, type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";

import { applyConversationDeletion } from "@/lib/chat/deletion";
import { buildFredConversationPdfContent } from "@/lib/chat/fred-actions";
import { downloadFredPdfFile } from "@/lib/chat/pdf-download";
import {
  clampSidebarHistoryPercent,
  DEFAULT_SIDEBAR_HISTORY_PERCENT,
  MAX_SIDEBAR_HISTORY_PERCENT,
  MIN_SIDEBAR_HISTORY_PERCENT,
  parseStoredApplicationNavigationExpanded,
  parseStoredSidebarHistoryPercent,
  SIDEBAR_APPLICATION_NAVIGATION_STORAGE_KEY,
  SIDEBAR_HISTORY_PERCENT_STORAGE_KEY,
} from "@/lib/chat/sidebar-split";
import { ellipsizeFilename } from "@/lib/attachment-names";
import RichAnswer from "@/components/rich-answer";
import {
  getSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import { parsePasswordChangeBody } from "@/lib/auth/password";
import {
  FORM_IMAGE_MIME_TYPES,
  isFormImageMimeType,
  MAX_FORM_IMAGE_BYTES,
  MAX_SALDO_INPUT_CHARS,
  VERF5_FORM_ID,
  VERF5_FORM_NAME,
} from "@/lib/forms/config";
import { normalizeManualSaldo } from "@/lib/forms/values";
import {
  GERMAN_SV_PENSION_YEARS,
  buildGermanSvPensionPdfDocument,
  calculateGermanSvPension,
  formatGermanSvEuro,
  formatGermanSvRate,
  parseGermanSvAmount,
  type GermanSvPensionMode,
  type GermanSvPensionYear,
} from "@/lib/german-sv-pension";
import {
  calculateGermanPensionOption,
  parseGermanPensionAmount,
  formatGermanPensionEuro,
} from "@/lib/german-pension-option";

import {
  L17B_YEARS,
  getL17bYearEntries,
  convertL17bCurrency,
  formatL17bForeignAmount,
  formatL17bEuro,
  lookupL17bEntry,
  getL17bSourceNote,
  parseL17bGermanAmount,
} from "@/lib/l17b-currency";
import FredNativeChatView, {
  type FredNativeAttachment,
  type FredNativeMessage,
} from "@/components/fred-native-chat-view";
import FredRunView from "@/components/fredrun-view";
import L17bCountrySelect from "@/components/l17b-country-select";
import ScanningView from "@/components/scanning-view";
import KnowledgeLandscapeView from "@/components/knowledge-landscape-view";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: FredNativeAttachment[];
  webSearchEnabled?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type AppView = "chat" | "scanning" | "forms" | "bfg-decisions" | "bfg-pro" | "german-sv-pension" | "l17b-currency" | "fredrun" | "administration" | "data";

type AuthForm = {
  email: string;
  password: string;
};

type PasswordChangeForm = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};


type AdminUserSummary = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
};

type AdminRequestHistoryEntry = {
  id: number;
  conversationId: string;
  content: string;
  createdAt: string;
};

type AdminUserProfile = {
  user: AdminUserSummary;
  requestCount: number;
  requests: AdminRequestHistoryEntry[];
};

type BfgDecision = {
  title: string;
  gz: string;
  documentType: string;
  publicationDate: string;
  snippet: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
};

type BfgSort = "1" | "2" | "3" | "4" | "7" | "10";

type BfgFacetOption = {
  value: string;
  label: string;
  count: number;
};

type BfgFilterFacets = {
  materie: BfgFacetOption[];
  documentType: BfgFacetOption[];
  norm: BfgFacetOption[];
  timeframe: BfgFacetOption[];
  withHeadnote: BfgFacetOption[];
};

type BfgFilterSelection = {
  materie: string;
  documentType: string;
  norm: string;
  timeframe: string;
  withHeadnote: boolean;
};

type BfgDecisionPage = {
  results: BfgDecision[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  facets: BfgFilterFacets;
};

type BfgProResult = {
  title: string;
  gz: string;
  documentType: string;
  decisionDate: string;
  publicationDate: string;
  caseSummary: string;
  whyRelevant: string;
  score: number;
  htmlUrl: string | null;
  pdfUrl: string | null;
};

const BFG_SORT_OPTIONS: ReadonlyArray<{ value: BfgSort; label: string }> = [
  { value: "1", label: "Relevanz" },
  { value: "2", label: "Genehmigungsdatum absteigend" },
  { value: "7", label: "Genehmigungsdatum aufsteigend" },
  { value: "3", label: "In Findok seit absteigend" },
  { value: "4", label: "In Findok seit aufsteigend" },
  { value: "10", label: "Geschäftszahl" },
];

function emptyBfgFilterSelection(): BfgFilterSelection {
  return { materie: "", documentType: "", norm: "", timeframe: "", withHeadnote: false };
}

function availableBfgFilterSelection(
  selection: BfgFilterSelection,
  facets: BfgFilterFacets,
): BfgFilterSelection {
  const availableValue = (value: string, options: BfgFacetOption[]) =>
    options.some((option) => option.value === value) ? value : "";
  return {
    materie: availableValue(selection.materie, facets.materie),
    documentType: availableValue(selection.documentType, facets.documentType),
    norm: availableValue(selection.norm, facets.norm),
    timeframe: availableValue(selection.timeframe, facets.timeframe),
    withHeadnote: selection.withHeadnote && facets.withHeadnote.some((option) => option.value === "true"),
  };
}

function normalizeConversationSummaries(value: unknown): ConversationSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): ConversationSummary[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const conversation = item as Record<string, unknown>;
    if (
      typeof conversation.id !== "string" ||
      typeof conversation.title !== "string" ||
      typeof conversation.createdAt !== "string" ||
      typeof conversation.updatedAt !== "string"
    ) {
      return [];
    }
    return [{
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }];
  });
}

function normalizeFredAttachments(value: unknown): FredNativeAttachment[] {
  if (!Array.isArray(value) || value.length > 10) return [];
  return value.flatMap((candidate): FredNativeAttachment[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (
      (item.kind !== "image" && item.kind !== "file")
      || typeof item.name !== "string"
      || typeof item.mimeType !== "string"
      || typeof item.sizeBytes !== "number"
      || (item.sha256 !== undefined && typeof item.sha256 !== "string")
    ) return [];
    return [{
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
    }];
  });
}

function normalizeFredMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message): ChatMessage[] => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const item = message as Record<string, unknown>;
    if (
      (item.role !== "user" && item.role !== "assistant")
      || typeof item.content !== "string"
    ) return [];
    const attachments = item.role === "user" ? normalizeFredAttachments(item.attachments) : [];
    return [{
      role: item.role,
      content: item.content,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      ...(attachments.length ? { attachments } : {}),
      ...(item.role === "user" && item.webSearchEnabled === true
        ? { webSearchEnabled: true }
        : {}),
    }];
  });
}

async function fetchFredConversationHistory(accessToken: string, id: string): Promise<{
  title: string;
  messages: ChatMessage[];
}> {
  const response = await fetch(`/api/fred/conversations/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Fred-Unterhaltung konnte nicht geladen werden.",
    );
  }
  const conversation = payload.conversation;
  const title = conversation && typeof conversation === "object" && !Array.isArray(conversation)
    && typeof (conversation as Record<string, unknown>).title === "string"
    ? ((conversation as Record<string, unknown>).title as string)
    : "Fred-Unterhaltung";
  return { title, messages: normalizeFredMessages(payload.messages) };
}

async function fetchAdminCapability(accessToken: string): Promise<{ isAdmin: boolean }> {
  const response = await fetch("/api/settings", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.isAdmin !== "boolean") {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Die Berechtigung konnte nicht geladen werden.",
    );
  }
  return { isAdmin: payload.isAdmin };
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatAdminDate(value: string | null): string {
  if (!value) {
    return "Noch nie";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function normalizeAdminUser(value: unknown): AdminUserSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || typeof item.email !== "string"
    || typeof item.createdAt !== "string"
    || (item.lastSignInAt !== null && typeof item.lastSignInAt !== "string")
  ) {
    return null;
  }
  return {
    id: item.id,
    email: item.email,
    createdAt: item.createdAt,
    lastSignInAt: item.lastSignInAt,
  };
}

function normalizeAdminUserProfile(value: unknown): AdminUserProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const profileUser = normalizeAdminUser(payload.user);
  if (!profileUser || typeof payload.requestCount !== "number" || !Array.isArray(payload.requests)) {
    return null;
  }
  const requests = payload.requests.flatMap((entry): AdminRequestHistoryEntry[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== "number"
      || typeof item.conversationId !== "string"
      || typeof item.content !== "string"
      || typeof item.createdAt !== "string"
    ) {
      return [];
    }
    return [{
      id: item.id,
      conversationId: item.conversationId,
      content: item.content,
      createdAt: item.createdAt,
    }];
  });
  if (requests.length !== payload.requests.length || payload.requestCount !== requests.length) {
    return null;
  }
  return { user: profileUser, requestCount: payload.requestCount, requests };
}

function normalizeBfgFacetOptions(value: unknown): BfgFacetOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options = value.flatMap((entry): BfgFacetOption[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.value !== "string"
      || typeof item.label !== "string"
      || typeof item.count !== "number"
      || !Number.isSafeInteger(item.count)
      || item.count < 0
    ) {
      return [];
    }
    return [{ value: item.value, label: item.label, count: item.count }];
  });
  return options.length === value.length ? options : null;
}

function normalizeBfgFacets(value: unknown): BfgFilterFacets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const materie = normalizeBfgFacetOptions(payload.materie);
  const documentType = normalizeBfgFacetOptions(payload.documentType);
  const norm = normalizeBfgFacetOptions(payload.norm);
  const timeframe = normalizeBfgFacetOptions(payload.timeframe);
  const withHeadnote = normalizeBfgFacetOptions(payload.withHeadnote);
  return materie && documentType && norm && timeframe && withHeadnote
    ? { materie, documentType, norm, timeframe, withHeadnote }
    : null;
}

function normalizeBfgDecisionPage(value: unknown): BfgDecisionPage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const facets = normalizeBfgFacets(payload.facets);
  if (
    !Array.isArray(payload.results)
    || typeof payload.page !== "number"
    || typeof payload.pageSize !== "number"
    || typeof payload.totalPages !== "number"
    || typeof payload.totalCount !== "number"
    || !facets
  ) {
    return null;
  }
  const results = payload.results.flatMap((value): BfgDecision[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.title !== "string"
      || typeof item.gz !== "string"
      || typeof item.documentType !== "string"
      || typeof item.publicationDate !== "string"
      || typeof item.snippet !== "string"
      || (item.htmlUrl !== null && typeof item.htmlUrl !== "string")
      || (item.pdfUrl !== null && typeof item.pdfUrl !== "string")
    ) {
      return [];
    }
    return [{
      title: item.title,
      gz: item.gz,
      documentType: item.documentType,
      publicationDate: item.publicationDate,
      snippet: item.snippet,
      htmlUrl: item.htmlUrl,
      pdfUrl: item.pdfUrl,
    }];
  });
  return results.length === payload.results.length
    ? {
        results,
        page: payload.page,
        pageSize: payload.pageSize,
        totalPages: payload.totalPages,
        totalCount: payload.totalCount,
        facets,
      }
    : null;
}

function normalizeBfgProResults(value: unknown): BfgProResult[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.results) || payload.results.length > 10) {
    return null;
  }
  const results = payload.results.flatMap((value): BfgProResult[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.title !== "string"
      || typeof item.gz !== "string"
      || typeof item.documentType !== "string"
      || typeof item.decisionDate !== "string"
      || typeof item.publicationDate !== "string"
      || typeof item.caseSummary !== "string"
      || !item.caseSummary.trim()
      || item.caseSummary.length > 400
      || typeof item.whyRelevant !== "string"
      || typeof item.score !== "number"
      || item.score < 0
      || item.score > 100
      || (item.htmlUrl !== null && typeof item.htmlUrl !== "string")
      || (item.pdfUrl !== null && typeof item.pdfUrl !== "string")
    ) {
      return [];
    }
    return [{
      title: item.title,
      gz: item.gz,
      documentType: item.documentType,
      decisionDate: item.decisionDate,
      publicationDate: item.publicationDate,
      caseSummary: item.caseSummary,
      whyRelevant: item.whyRelevant,
      score: item.score,
      htmlUrl: item.htmlUrl,
      pdfUrl: item.pdfUrl,
    }];
  });
  return results.length === payload.results.length ? results : null;
}

function formatBfgPublicationDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function renderUserMessageContent(content: string): ReactNode {
  return (
    <p className="message-body">
      {content.split("\n").map((line, index) => {
        const match = /^(PDF-Anhang|Bild-Anhang):\s*(.+)$/.exec(line);
        const prefix = index > 0 ? "\n" : "";

        if (!match) {
          return <Fragment key={`${index}-${line}`}>{prefix}{line}</Fragment>;
        }

        const label = match[1];
        const filename = match[2];
        return (
          <Fragment key={`${index}-${line}`}>
            {prefix}
            <span className="attachment-message-line">
              <span>{label}: </span>
              <span className="inline-attachment-name" title={filename}>
                {ellipsizeFilename(filename)}
              </span>
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}

function L17bCurrencyView() {
  const [selectedYear, setSelectedYear] = useState("2025");
  const [selectedCode, setSelectedCode] = useState("");
  const [amountInput, setAmountInput] = useState("");

  const entries = getL17bYearEntries(selectedYear) ?? [];
  const amount = parseL17bGermanAmount(amountInput);
  const entry = selectedCode ? lookupL17bEntry(selectedYear, selectedCode) : undefined;
  const result = entry !== undefined && amount !== null ? convertL17bCurrency(selectedYear, selectedCode, amount) : null;
  const hasInvalidInput = amountInput.trim() !== "" && amount === null;

  function handleYearChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newYear = event.target.value;
    setSelectedYear(newYear);
    const newEntries = getL17bYearEntries(newYear) ?? [];
    const stillAvailable = selectedCode && newEntries.some((e) => e.currencyCode === selectedCode);
    if (!stillAvailable) {
      setSelectedCode("");
    }
  }

  function handleAmountChange(event: React.ChangeEvent<HTMLInputElement>) {
    setAmountInput(event.target.value);
  }

  return (
    <section className="forms-panel" aria-labelledby="l17b-currency-view-title">
      <div className="forms-view l17b-currency-view">
        <header className="forms-view-header bfg-view-header">
          <div className="bfg-view-header-copy">
            <h1 id="l17b-currency-view-title">L17b Währungsrechner</h1>
          </div>
          <Image
            className="bfg-view-header-illustration"
            src="/fred_l17b.png"
            alt=""
            width={376}
            height={376}
            unoptimized
          />
        </header>
        <div className="german-sv-calculator-card l17b-calculator-card">
          <div className="field-group">
            <label htmlFor="l17b-year-select">Jahr</label>
            <select
              id="l17b-year-select"
              value={selectedYear}
              onChange={handleYearChange}
              autoComplete="off"
            >
              {L17B_YEARS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="l17b-country-select">Land</label>
            <L17bCountrySelect
              entries={entries}
              selectedCode={selectedCode}
              onChange={setSelectedCode}
            />
          </div>
          <div className="field-group">
            <label htmlFor="l17b-amount-input">
              {entry
                ? `Betrag in ${entry.currencyName} (${entry.currencyCode})`
                : "Betrag"}
            </label>
            <input
              id="l17b-amount-input"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={handleAmountChange}
              placeholder="z. B. 1.308,70"
              autoComplete="off"
              aria-describedby={hasInvalidInput ? "l17b-amount-error" : undefined}
            />
            {hasInvalidInput ? (
              <span className="field-help" id="l17b-amount-error" role="alert">
                Ungültige Eingabe. Bitte einen gültigen Zahlenwert eingeben (z. B. 1.308,70).
              </span>
            ) : null}
          </div>
          <div className="german-sv-results l17b-result" aria-live="polite">
            <article>
              <h2>Ergebnis in Euro</h2>
              <output>{entry !== undefined && result !== null ? formatL17bEuro(result) : "—"}</output>
              {entry !== undefined && result !== null ? (
                <p className="l17b-calculation-basis">
                  Steuerwert {entry.steuerwertRaw} EUR/{entry.currencyCode} × {formatL17bForeignAmount(amount!, entry.currencyCode)} = {formatL17bEuro(result)}
                </p>
              ) : null}
            </article>
          </div>

          <p className="l17b-source-note">
            Quelle: {getL17bSourceNote(selectedYear)}. Verwendet wird ausschließlich der Steuerwert {selectedYear}.
          </p>
        </div>
      </div>
    </section>
  );
}

type GermanSvPensionViewProps = {
  downloadError: string;
  isDownloadingPdf: boolean;
  onDownloadPdf: (
    year: GermanSvPensionYear,
    mode: GermanSvPensionMode,
    amount: number,
  ) => Promise<void>;
};

function GermanSvPensionView({
  downloadError,
  isDownloadingPdf,
  onDownloadPdf,
}: GermanSvPensionViewProps) {
  const [year, setYear] = useState<GermanSvPensionYear>(2026);
  const [mode, setMode] = useState<GermanSvPensionMode>("kv");
  const [amountInput, setAmountInput] = useState("");
  const pdfDownloadPendingRef = useRef(false);
  const amount = parseGermanSvAmount(amountInput);
  const calculation = amount === null ? null : calculateGermanSvPension(year, mode, amount);
  const displayMoney = (value: number | undefined) =>
    value === undefined ? "— €" : formatGermanSvEuro(value);
  const inputLabel = mode === "kv" ? "KV-Beitrag" : "Rentenbrutto / AEOI-KM";

  async function downloadPdf() {
    if (amount === null || isDownloadingPdf || pdfDownloadPendingRef.current) {
      return;
    }
    pdfDownloadPendingRef.current = true;
    try {
      await onDownloadPdf(year, mode, amount);
    } finally {
      pdfDownloadPendingRef.current = false;
    }
  }

  return (
    <section className="forms-panel" aria-labelledby="german-sv-pension-view-title">
      <div className="forms-view german-sv-pension-view">
        <header className="forms-view-header bfg-view-header german-sv-pension-header">
          <div className="bfg-view-header-copy">
            <h1 id="german-sv-pension-view-title">Kennzahl 453 &amp; 184</h1>
          </div>
          <Image
            className="bfg-view-header-illustration"
            src="/fred-german-sv-pension.png"
            alt=""
            width={376}
            height={376}
            unoptimized
          />
        </header>

        <div className="german-sv-year-control" role="group" aria-label="Veranlagungsjahr">
          <span>Veranlagungsjahr</span>
          <div className="german-sv-year-options">
            {GERMAN_SV_PENSION_YEARS.map((option) => (
              <button
                className={year === option ? "active" : undefined}
                type="button"
                aria-pressed={year === option}
                onClick={() => setYear(option)}
                key={option}
              >
                {option === 2024 ? "bis 2024" : option}
              </button>
            ))}
          </div>
        </div>

        <div className="german-sv-calculator-card">
          <p className="german-sv-rate-line">
            <span>KV-Beitragssatz lt. § 73a ASVG: <strong>{formatGermanSvRate(year)}</strong></span>
            <span>Jahr: <strong>{year}</strong></span>
          </p>

          <fieldset className="german-sv-mode">
            <legend>Eingabe entweder …</legend>
            <label className={mode === "kv" ? "active" : undefined}>
              <input
                type="radio"
                name="german-sv-pension-mode"
                value="kv"
                checked={mode === "kv"}
                onChange={() => setMode("kv")}
              />
              <span>
                <strong>KV-Beitrag</strong>
                <small>österr. Krankenversicherungsbeitrag gem. § 73a ASVG</small>
              </span>
            </label>
            <label className={mode === "rentenbrutto" ? "active" : undefined}>
              <input
                type="radio"
                name="german-sv-pension-mode"
                value="rentenbrutto"
                checked={mode === "rentenbrutto"}
                onChange={() => setMode("rentenbrutto")}
              />
              <span>
                <strong>Rentenbrutto / AEOI-KM</strong>
                <small>dt. Bemessungsgrundlage lt. AJ-Web bzw. KV-Bmgl</small>
              </span>
            </label>
          </fieldset>

          <div className="field-group german-sv-amount-field">
            <label htmlFor="german-sv-pension-amount">{inputLabel}</label>
            <div className="german-sv-amount-input">
              <span aria-hidden="true">€</span>
              <input
                id="german-sv-pension-amount"
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="0,00"
                autoComplete="off"
                aria-describedby="german-sv-pension-amount-help"
              />
            </div>
            <span className="field-help" id="german-sv-pension-amount-help">Betrag in Euro, z. B. 1.308,70</span>
          </div>

          <div className="german-sv-calculation-trail" aria-label="Berechnungsschritte" aria-live="polite">
            <div>
              <span className="german-sv-step-number">1</span>
              <span>
                <strong>Krankenversicherung gem. § 73a ASVG</strong>
                <small>{mode === "kv" ? "Eingabe" : "= Rentenbrutto × Beitragssatz"}</small>
              </span>
              <output>{displayMoney(calculation?.kvBeitrag)}</output>
            </div>
            <div>
              <span className="german-sv-step-number">2</span>
              <span>
                <strong>dt. Zuschuss zur Krankenversicherung</strong>
                <small>{mode === "kv" ? "= KV-Beitrag ÷ 2" : "= Rentenbrutto × halber Beitragssatz"}</small>
              </span>
              <output>{displayMoney(calculation?.zuschuss)}</output>
            </div>
            <div>
              <span className="german-sv-step-number">3</span>
              <span>
                <strong>dt. „Jahresbetrag der Rente“ = Bmgl. KV</strong>
                <small>{mode === "kv" ? "= KV-Beitrag ÷ Beitragssatz" : "Eingabe (Rentenbrutto / AEOI-KM)"}</small>
              </span>
              <output>{displayMoney(calculation?.bmgl)}</output>
            </div>
          </div>

          <div className="german-sv-results" aria-live="polite">
            <article>
              <p>Kz 453</p>
              <h2>Steuerpflichtige Einkünfte</h2>
              <output>{displayMoney(calculation?.kz453)}</output>
            </article>
            <article>
              <p>Kz 184</p>
              <h2>Sozialversicherungsbeiträge (KV-Beitrag)</h2>
              <output>{displayMoney(calculation?.kz184)}</output>
            </article>
          </div>

          <p className="german-sv-check-line">
            {calculation
              ? <>Vereinfachte Berechnung: Kz 453 = <strong>{(calculation.simplifiedFactor * 100).toLocaleString("de-AT", { maximumFractionDigits: 6 })} %</strong> von KV-Bmgl / AEOI-KM.</>
              : "Vereinfachte Kontrollrechnung erscheint hier, sobald ein Betrag eingegeben ist."}
          </p>

          <div className="german-sv-pdf-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void downloadPdf()}
              disabled={calculation === null || isDownloadingPdf}
            >
              {isDownloadingPdf ? "PDF wird erstellt…" : "Berechnung als PDF herunterladen"}
            </button>
          </div>

          {downloadError ? (
            <div className="error-box" role="alert" aria-live="polite">
              {downloadError}
            </div>
          ) : null}
        </div>

        <p className="german-sv-source">Stand 26.06.2026</p>

        <GermanPensionOptionView />

      </div>
    </section>
  );
}

function GermanPensionOptionView() {
  const [currentYearInput, setCurrentYearInput] = useState("");
  const [firstFullYearInput, setFirstFullYearInput] = useState("");
  const [firstFullGrossInput, setFirstFullGrossInput] = useState("");
  const [currentAnnualGrossInput, setCurrentAnnualGrossInput] = useState("");

  const parseYear = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && Number.isInteger(n) ? n : null;
  };

  const currentYear = parseYear(currentYearInput);
  const firstFullPensionYear = parseYear(firstFullYearInput);
  const firstFullGrossPension = parseGermanPensionAmount(firstFullGrossInput);
  const currentAnnualGrossPension = parseGermanPensionAmount(currentAnnualGrossInput);

  const inputReady = currentYear !== null
    && firstFullPensionYear !== null
    && firstFullGrossPension !== null
    && currentAnnualGrossPension !== null;

  const calculation = inputReady
    ? calculateGermanPensionOption({
        currentYear,
        firstFullPensionYear,
        firstFullGrossPension,
        currentAnnualGrossPension,
      })
    : null;

  const displayEuro = (value: number | undefined): string =>
    value === undefined ? "—" : formatGermanPensionEuro(value);

  const displayBool = (value: boolean | undefined): string => {
    if (value === undefined) return "—";
    return value ? "Ja" : "Nein";
  };

  const formatPercent = (value: number): string =>
    `${(value * 100).toLocaleString("de-AT", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })} %`;

  const hasResult = calculation?.available === true;

  return (
    <div className="german-option-card">
      <h2 className="german-option-heading">Optionsmöglichkeit in Deutschland</h2>
      <p className="german-option-subheading">
        Vereinfachter Schnellcheck — keine vollständige Prüfung nach § 1 Abs. 3
        EStG / 90-%-Test. Dieser Rechner prüft ausschließlich den Vergleich der
        österreichischen Pension mit dem deutschen Grundfreibetrag.
      </p>

      <div className="german-option-field-grid">
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-current-year">
            Aktuelles Jahr
          </label>
          <div className="german-option-input-wrap">
            <input
              id="gpo-current-year"
              type="text"
              inputMode="numeric"
              value={currentYearInput}
              onChange={(e) => setCurrentYearInput(e.target.value)}
              placeholder="z. B. 2026"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-first-full-year">
            Erstes volles Bezugsjahr
          </label>
          <div className="german-option-input-wrap">
            <input
              id="gpo-first-full-year"
              type="text"
              inputMode="numeric"
              value={firstFullYearInput}
              onChange={(e) => setFirstFullYearInput(e.target.value)}
              placeholder="z. B. 2016"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-first-full-gross">
            Pension brutto im ersten vollen Bezugsjahr
          </label>
          <div className="german-option-input-wrap">
            <span aria-hidden="true">€</span>
            <input
              id="gpo-first-full-gross"
              type="text"
              inputMode="decimal"
              value={firstFullGrossInput}
              onChange={(e) => setFirstFullGrossInput(e.target.value)}
              placeholder="0,00"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-current-gross">
            Aktuelle österreichische PVA/SVA-Bruttopension
          </label>
          <div className="german-option-input-wrap">
            <span aria-hidden="true">€</span>
            <input
              id="gpo-current-gross"
              type="text"
              inputMode="decimal"
              value={currentAnnualGrossInput}
              onChange={(e) => setCurrentAnnualGrossInput(e.target.value)}
              placeholder="0,00"
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      {calculation === null ? (
        <div className="german-option-empty" aria-live="polite">
          Bitte alle Felder ausfüllen, um den Schnellcheck durchzuführen.
        </div>
      ) : !calculation.available ? (
        <div className="german-option-data-unavailable" role="alert" aria-live="polite">
          {calculation.unavailableReason}
        </div>
      ) : null}

      <div
        className="german-option-step-group"
        aria-label="Berechnungsschritte"
        aria-live="polite"
      >
        <div className="german-option-step">
          <span className="german-option-step-num">1</span>
          <span className="german-option-step-label">
            <strong>Rentenfreibetragssatz</strong>
            <small>Jahr des ersten vollen Bezugs: {firstFullPensionYear ?? "—"}</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? formatPercent(calculation.exemptionRate) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">2</span>
          <span className="german-option-step-label">
            <strong>Fixer Rentenfreibetrag (EUR)</strong>
            <small>Pension 1. Jahr × Freibetragssatz</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.fixedPensionExemptionEur) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">3</span>
          <span className="german-option-step-label">
            <strong>Progressionsvorbehalt (EUR)</strong>
            <small>Aktuelle Bruttopension − fixer Freibetrag</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.progressionIncomeEur) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">4</span>
          <span className="german-option-step-label">
            <strong>Individueller Grundfreibetrag (EUR)</strong>
            <small>Jahr: {currentYear ?? "—"}</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.basicAllowanceEur) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">5</span>
          <span className="german-option-step-label">
            <strong>Differenz zum Grundfreibetrag (EUR)</strong>
            <small>Progressionsvorbehalt − Grundfreibetrag</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.differenceToBasicAllowanceEur) : "—"}
          </span>
        </div>
      </div>

      <div className="german-option-result-grid" aria-live="polite">
        <div className={`german-option-result-item${hasResult ? (calculation.optionPossible ? " output-yes" : " output-no") : ""}`}>
          <p>Prüfung</p>
          <h3>Option möglich</h3>
          <output>Option möglich: {hasResult ? displayBool(calculation.optionPossible) : "—"}</output>
        </div>
        <div className={`german-option-result-item label-l1i${hasResult ? (calculation.optionPossible ? " output-yes" : " output-no") : ""}`}>
          <p>Kennzahl</p>
          <h3>L1i Feld 4.2</h3>
          <output>L1i Feld 4.2: {hasResult ? displayBool(calculation.optionPossible) : "—"}</output>
        </div>
      </div>

      <div className="german-option-disclaimer" role="note">
        <strong>Hinweis:</strong> Dieser Schnellcheck prüft ausschließlich den
        Vergleich der differenzbesteuerten österreichischen Pension mit dem
        deutschen Grundfreibetrag. Es wird keine vollständige Prüfung nach § 1
        Abs. 3 EStG / 90-%-Test durchgeführt.
      </div>
    </div>
  );
}



const ADMIN_TAB_IDS = ["scanning", "benutzer"] as const;
function handleAdminTabKeyDown(event: React.KeyboardEvent, currentTab: string): void {
  const currentIndex = ADMIN_TAB_IDS.indexOf(currentTab as typeof ADMIN_TAB_IDS[number]);
  let nextIndex: number | undefined;
  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % ADMIN_TAB_IDS.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + ADMIN_TAB_IDS.length) % ADMIN_TAB_IDS.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = ADMIN_TAB_IDS.length - 1;
  }
  if (nextIndex !== undefined) {
    event.preventDefault();
    const nextId = ADMIN_TAB_IDS[nextIndex];
    const button = document.getElementById(`admin-tab-${nextId}`) as HTMLElement | null;
    button?.click();
    button?.focus();
  }
}
export default function Home() {
  const supabase = getSupabaseBrowserClient();
  const [fredConversationId, setFredConversationId] = useState("");
  const [fredMessages, setFredMessages] = useState<ChatMessage[]>([]);
  const [fredConversations, setFredConversations] = useState<ConversationSummary[]>([]);
  const [selectedFredConversationIds, setSelectedFredConversationIds] = useState<string[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloadingFredConversationPdf, setIsDownloadingFredConversationPdf] = useState(false);
  const [error, setError] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [sidebarHistoryPercent, setSidebarHistoryPercent] = useState(
    DEFAULT_SIDEBAR_HISTORY_PERCENT,
  );
  const [isApplicationNavigationExpanded, setIsApplicationNavigationExpanded] = useState(true);
  const [isSidebarSplitResizing, setIsSidebarSplitResizing] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminNotice, setAdminNotice] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminUserProfile, setAdminUserProfile] = useState<AdminUserProfile | null>(null);
  const [adminUserForm, setAdminUserForm] = useState({ email: "", password: "" });
  const [isAdminUsersLoading, setIsAdminUsersLoading] = useState(false);
  const [isAdminUserCreating, setIsAdminUserCreating] = useState(false);
  const [isAdminUserMutationRunning, setIsAdminUserMutationRunning] = useState(false);
  const [adminTab, setAdminTab] = useState<"scanning" | "benutzer">("scanning");
  const [scanningModelId, setScanningModelId] = useState("");
  const [scanningPrompt, setScanningPrompt] = useState("");
  const [isScanningSettingsLoading, setIsScanningSettingsLoading] = useState(false);
  const [isScanningSettingsSaving, setIsScanningSettingsSaving] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [authForm, setAuthForm] = useState<AuthForm>({ email: "", password: "" });
  const [passwordChangeForm, setPasswordChangeForm] = useState<PasswordChangeForm>({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChangeNotice, setPasswordChangeNotice] = useState("");
  const [isPasswordChangeSubmitting, setIsPasswordChangeSubmitting] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState("");
  const [isAccountDeletionSubmitting, setIsAccountDeletionSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [appView, setAppView] = useState<AppView>("chat");
  const [bfgQuery, setBfgQuery] = useState("");
  const [bfgSort, setBfgSort] = useState<BfgSort>("1");
  const [bfgAppliedSort, setBfgAppliedSort] = useState<BfgSort>("1");
  const [bfgFilters, setBfgFilters] = useState<BfgFilterSelection>(emptyBfgFilterSelection);
  const [bfgAppliedFilters, setBfgAppliedFilters] = useState<BfgFilterSelection>(emptyBfgFilterSelection);
  const [isBfgFilterPanelOpen, setIsBfgFilterPanelOpen] = useState(false);
  const [bfgPage, setBfgPage] = useState<BfgDecisionPage | null>(null);
  const [bfgError, setBfgError] = useState("");
  const [hasSearchedBfg, setHasSearchedBfg] = useState(false);
  const [isSearchingBfg, setIsSearchingBfg] = useState(false);
  const [bfgProScenario, setBfgProScenario] = useState("");
  const [bfgProResults, setBfgProResults] = useState<BfgProResult[] | null>(null);
  const [bfgProError, setBfgProError] = useState("");
  const [isSearchingBfgPro, setIsSearchingBfgPro] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState<"" | typeof VERF5_FORM_ID>("");
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formSaldo, setFormSaldo] = useState("");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [isGeneratingForm, setIsGeneratingForm] = useState(false);
  const [isDownloadingGermanSvPensionPdf, setIsDownloadingGermanSvPensionPdf] = useState(false);
  const formImageInputRef = useRef<HTMLInputElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsDialogCloseRef = useRef<HTMLButtonElement>(null);
  const authenticatedUserIdRef = useRef<string | null>(null);
  const sidebarSplitRegionRef = useRef<HTMLDivElement>(null);
  const sidebarHistoryPercentRef = useRef(DEFAULT_SIDEBAR_HISTORY_PERCENT);
  const user = session?.user ?? null;
  const signedInEmail = user?.email ?? "";
  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
        setSettingsOpen(false);
      }
      setIsLoaded(true);
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      try {
        const storedHistoryPercent = parseStoredSidebarHistoryPercent(
          window.localStorage.getItem(SIDEBAR_HISTORY_PERCENT_STORAGE_KEY),
        );
        sidebarHistoryPercentRef.current = storedHistoryPercent;
        setSidebarHistoryPercent(storedHistoryPercent);
        setIsApplicationNavigationExpanded(
          parseStoredApplicationNavigationExpanded(
            window.localStorage.getItem(SIDEBAR_APPLICATION_NAVIGATION_STORAGE_KEY),
          ),
        );
      } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  const persistSidebarHistoryPercent = useCallback((value: number) => {
    try {
      window.localStorage.setItem(SIDEBAR_HISTORY_PERCENT_STORAGE_KEY, String(value));
    } catch {
      // Resizing remains usable when storage is unavailable.
    }
  }, []);

  const updateSidebarHistoryPercent = useCallback((value: number, persist = false) => {
    const nextValue = clampSidebarHistoryPercent(value);
    sidebarHistoryPercentRef.current = nextValue;
    setSidebarHistoryPercent(nextValue);
    if (persist) {
      persistSidebarHistoryPercent(nextValue);
    }
  }, [persistSidebarHistoryPercent]);

  const updateSidebarHistoryPercentFromPointer = useCallback((clientY: number) => {
    const splitRegion = sidebarSplitRegionRef.current;
    if (!splitRegion) {
      return;
    }

    const bounds = splitRegion.getBoundingClientRect();
    if (bounds.height <= 0) {
      return;
    }

    updateSidebarHistoryPercent(((clientY - bounds.top) / bounds.height) * 100);
  }, [updateSidebarHistoryPercent]);

  const handleSidebarSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsSidebarSplitResizing(true);
  };

  const handleSidebarSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

    updateSidebarHistoryPercentFromPointer(event.clientY);
  };

  const finishSidebarSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsSidebarSplitResizing(false);
    persistSidebarHistoryPercent(sidebarHistoryPercentRef.current);
  };

  const handleSidebarSplitKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | undefined;
    if (event.key === "ArrowUp") {
      nextValue = sidebarHistoryPercentRef.current - 5;
    } else if (event.key === "ArrowDown") {
      nextValue = sidebarHistoryPercentRef.current + 5;
    } else if (event.key === "Home") {
      nextValue = MIN_SIDEBAR_HISTORY_PERCENT;
    } else if (event.key === "End") {
      nextValue = MAX_SIDEBAR_HISTORY_PERCENT;
    }

    if (nextValue !== undefined) {
      event.preventDefault();
      updateSidebarHistoryPercent(nextValue, true);
    }
  };

  const toggleApplicationNavigation = () => {
    const nextValue = !isApplicationNavigationExpanded;
    setIsApplicationNavigationExpanded(nextValue);
    try {
      window.localStorage.setItem(
        SIDEBAR_APPLICATION_NAVIGATION_STORAGE_KEY,
        String(nextValue),
      );
    } catch {
      // The toggle remains usable when storage is unavailable.
    }
  };

  useEffect(() => {
    if (!supabase) {
      queueMicrotask(() => {
        setIsAuthLoaded(true);
      });
      return;
    }

    let isActive = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return;
      }

      setSession(nextSession);
      setError("");
      setAuthError("");
      setIsAuthLoaded(true);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!isLoaded || !isAuthLoaded) {
      return;
    }

    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      if (!user?.id) {
        authenticatedUserIdRef.current = null;
        setFredConversationId("");
        setFredMessages([]);
        setFredConversations([]);
        setSelectedFredConversationIds([]);
        setAppView("chat");
        setBfgQuery("");
        setBfgPage(null);
        setBfgError("");
        setHasSearchedBfg(false);
        setIsSearchingBfg(false);
        setSelectedFormId("");
        setFormImage(null);
        setFormSaldo("");
        setFormError("");
        setFormNotice("");
        setIsGeneratingForm(false);
        setAdminUsers([]);
        setAdminUserProfile(null);
        setAdminUserForm({ email: "", password: "" });
        setAdminTab("scanning");
        setScanningModelId("");
        setScanningPrompt("");
        return;
      }

      const isFreshAuthenticatedLanding = authenticatedUserIdRef.current !== user.id;
      authenticatedUserIdRef.current = user.id;
      if (isFreshAuthenticatedLanding) {
        setAppView("chat");
        setFredConversationId("");
        setFredMessages([]);
        setError("");
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        return;
      }
      setIsHistoryLoading(true);
      void (async () => {
        try {
          const fredResponse = await fetch("/api/fred/conversations", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const fredPayload = await fredResponse.json().catch(() => ({})) as Record<string, unknown>;
          if (!isActive) {
            return;
          }
          if (fredResponse.ok) {
            setFredConversations(normalizeConversationSummaries(fredPayload.conversations));
          } else {
            throw new Error(typeof fredPayload.error === "string"
              ? fredPayload.error
              : "Fred-Verlauf konnte nicht geladen werden.");
          }
        } catch (historyError) {
          if (isActive) {
            setError(historyError instanceof Error
              ? historyError.message
              : "Gesprächsverlauf konnte nicht geladen werden.");
          }
        } finally {
          if (isActive) {
            setIsHistoryLoading(false);
          }
        }
      })();
    });

    return () => {
      isActive = false;
    };
  }, [isAuthLoaded, isLoaded, session?.access_token, user?.id]);

  useEffect(() => {
    const accessToken = session?.access_token;
    if (!accessToken || !user?.id) {
      queueMicrotask(() => {
        setIsAdmin(false);
        setAppView((current) => current === "administration" ? "chat" : current);
      });
      return;
    }

    let isActive = true;
    void fetchAdminCapability(accessToken)
      .then((adminCapability) => {
        if (!isActive) {
          return;
        }
        setIsAdmin(adminCapability.isAdmin);
        if (!adminCapability.isAdmin) {
          setAppView((current) => current === "administration" ? "chat" : current);
        }
      })
      .catch(() => {
        if (isActive) {
          setIsAdmin(false);
          setAppView((current) => current === "administration" ? "chat" : current);
        }
      });

    return () => {
      isActive = false;
    };
  }, [session?.access_token, user?.id]);

  useEffect(() => {
    if (!isSettingsDialogOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSettingsDialog();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          settingsDialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href]",
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    settingsDialogCloseRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSettingsDialog, isSettingsDialogOpen]);

  function updateAuthForm<Key extends keyof AuthForm>(key: Key, value: AuthForm[Key]) {
    setAuthForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updatePasswordChangeForm<Key extends keyof PasswordChangeForm>(
    key: Key,
    value: PasswordChangeForm[Key],
  ) {
    setPasswordChangeForm((current) => ({
      ...current,
      [key]: value,
    }));
    setPasswordChangeError("");
    setPasswordChangeNotice("");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAuthSubmitting) {
      return;
    }
    if (!supabase) {
      setAuthError("Supabase Auth ist noch nicht konfiguriert.");
      return;
    }

    const email = authForm.email.trim();
    const password = authForm.password;

    if (!email || !password) {
      setAuthError("Bitte E-Mail-Adresse und Passwort eingeben.");
      return;
    }
    if (password.length < 6) {
      setAuthError("Das Passwort muss mindestens 6 Zeichen lang sein.");
      return;
    }

    setAuthError("");
    setIsAuthSubmitting(true);

    try {
      const { error: authSubmitError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authSubmitError) {
        throw authSubmitError;
      }

      setAuthForm({ email: "", password: "" });
    } catch {
      setAuthError("Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPasswordChangeSubmitting) {
      return;
    }

    let input;
    try {
      input = parsePasswordChangeBody(passwordChangeForm);
    } catch (validationError) {
      setPasswordChangeError(
        validationError instanceof Error
          ? validationError.message
          : "Die Passwortangaben sind ungültig.",
      );
      setPasswordChangeNotice("");
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken) {
      setPasswordChangeError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      setPasswordChangeNotice("");
      return;
    }

    setPasswordChangeError("");
    setPasswordChangeNotice("");
    setIsPasswordChangeSubmitting(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das Passwort konnte nicht geändert werden.",
        );
      }

      setPasswordChangeForm({ currentPassword: "", newPassword: "", confirmation: "" });
      setPasswordChangeNotice("Das Passwort wurde erfolgreich geändert.");
    } catch (passwordError) {
      setPasswordChangeError(
        passwordError instanceof Error
          ? passwordError.message
          : "Das Passwort konnte nicht geändert werden.",
      );
    } finally {
      setIsPasswordChangeSubmitting(false);
    }
  }

  async function deleteOwnAccount() {
    if (isAccountDeletionSubmitting) {
      return;
    }
    if (!window.confirm(
      "Dein Konto wirklich dauerhaft löschen? Konto, Unterhaltungen und Anfrageverlauf werden unwiderruflich entfernt.",
    )) {
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken || !user?.id) {
      setAccountDeletionError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setAccountDeletionError("");
    setIsAccountDeletionSubmitting(true);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das Benutzerkonto konnte nicht gelöscht werden.",
        );
      }

      try {
        await supabase?.auth.signOut({ scope: "local" });
      } catch {
        // The server has already deleted the user; local cleanup must still complete.
      }
      setSession(null);
      setFredConversationId("");
      setFredMessages([]);
      setFredConversations([]);
      setSelectedFredConversationIds([]);
      setIsAdmin(false);
      setAppView("chat");
      closeSettingsDialog();
    } catch (deletionError) {
      setAccountDeletionError(
        deletionError instanceof Error
          ? deletionError.message
          : "Das Benutzerkonto konnte nicht gelöscht werden.",
      );
    } finally {
      setIsAccountDeletionSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!supabase || isAuthSubmitting) {
      return;
    }

    setAuthError("");
    setIsAuthSubmitting(true);

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }

      setSession(null);
      setFredConversationId("");
      setFredMessages([]);
      setFredConversations([]);
      setSelectedFredConversationIds([]);
      setError("");
    } catch {
      setAuthError("Abmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function openFormsView() {
    setAppView("forms");
    setSelectedFormId("");
    setFormImage(null);
    setFormSaldo("");
    setFormError("");
    setFormNotice("");
    if (formImageInputRef.current) {
      formImageInputRef.current.value = "";
    }
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openDataView() {
    setAppView("data");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openBfgDecisionsView() {
    setAppView("bfg-decisions");
    setBfgError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openBfgProView() {
    setAppView("bfg-pro");
    setBfgProError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openGermanSvPensionView() {
    setAppView("german-sv-pension");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openL17bCurrencyView() {
    setAppView("l17b-currency");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openFredRunView() {
    setAppView("fredrun");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openFredView() {
    setAppView("chat");
    setFredConversationId("");
    setFredMessages([]);
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  async function searchBfgPro() {
    const scenario = bfgProScenario.trim();
    const accessToken = session?.access_token;
    if (!scenario) {
      setBfgProError("Bitte einen Sachverhalt eingeben.");
      return;
    }
    if (!accessToken) {
      setBfgProError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setBfgProError("");
    setBfgProResults(null);
    setIsSearchingBfgPro(true);
    try {
      const response = await fetch("/api/findok/bfg/pro", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario }),
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {};
        throw new Error(
          typeof errorPayload.error === "string"
            ? errorPayload.error
            : "Die BFG Suche PRO konnte nicht durchgeführt werden.",
        );
      }
      const results = normalizeBfgProResults(payload);
      if (!results) {
        throw new Error("Die BFG Suche PRO lieferte eine ungültige Antwort.");
      }
      setBfgProResults(results);
    } catch (searchError) {
      setBfgProError(
        searchError instanceof Error
          ? searchError.message
          : "Die BFG Suche PRO konnte nicht durchgeführt werden.",
      );
    } finally {
      setIsSearchingBfgPro(false);
    }
  }

  function updateBfgFilter<Key extends keyof BfgFilterSelection>(
    key: Key,
    value: BfgFilterSelection[Key],
  ) {
    setBfgFilters((current) => ({ ...current, [key]: value }));
  }

  async function searchBfgDecisions(
    page: number,
    controls = { sort: bfgAppliedSort, filters: bfgAppliedFilters },
  ) {
    const query = bfgQuery.trim();
    const accessToken = session?.access_token;
    if (!query) {
      setBfgError("Bitte einen Suchbegriff oder eine Geschäftszahl eingeben.");
      return;
    }
    if (!accessToken) {
      setBfgError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setBfgError("");
    setIsSearchingBfg(true);
    try {
      const parameters = new URLSearchParams({
        q: query,
        page: String(page),
        size: "10",
      });
      parameters.set("sort", controls.sort);
      if (controls.filters.materie) {
        parameters.set("materie", controls.filters.materie);
      }
      if (controls.filters.documentType) {
        parameters.set("documentType", controls.filters.documentType);
      }
      if (controls.filters.norm) {
        parameters.set("norm", controls.filters.norm);
      }
      if (controls.filters.timeframe) {
        parameters.set("timeframe", controls.filters.timeframe);
      }
      if (controls.filters.withHeadnote) {
        parameters.set("withHeadnote", "true");
      }
      setBfgAppliedSort(controls.sort);
      setBfgAppliedFilters(controls.filters);
      const response = await fetch(`/api/findok/bfg?${parameters.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {};
        throw new Error(
          typeof errorPayload.error === "string"
            ? errorPayload.error
            : "Die BFG-Suche konnte nicht durchgeführt werden.",
        );
      }
      const normalized = normalizeBfgDecisionPage(payload);
      if (!normalized) {
        throw new Error("Findok lieferte eine ungültige Antwort.");
      }
      setBfgPage(normalized);
      setBfgFilters((current) => availableBfgFilterSelection(current, normalized.facets));
      setHasSearchedBfg(true);
    } catch (searchError) {
      setBfgError(
        searchError instanceof Error
          ? searchError.message
          : "Die BFG-Suche konnte nicht durchgeführt werden.",
      );
    } finally {
      setIsSearchingBfg(false);
    }
  }

  function resetBfgFilters() {
    const filters = emptyBfgFilterSelection();
    setBfgFilters(filters);
    if (hasSearchedBfg) {
      void searchBfgDecisions(1, { sort: bfgSort, filters });
    }
  }

  async function loadScanningSettings(accessToken: string) {
    setIsScanningSettingsLoading(true);
    try {
      const response = await fetch("/api/admin/scanning-settings", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (
        !response.ok
        || typeof payload.modelId !== "string"
        || !payload.modelId.trim()
        || typeof payload.prompt !== "string"
        || !payload.prompt.trim()
        || typeof payload.updatedAt !== "string"
      ) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Die Scanning-Konfiguration konnte nicht geladen werden.",
        );
      }
      setScanningModelId(payload.modelId);
      setScanningPrompt(payload.prompt);
    } catch (settingsError) {
      setAdminError(settingsError instanceof Error
        ? settingsError.message
        : "Die Scanning-Konfiguration konnte nicht geladen werden.");
    } finally {
      setIsScanningSettingsLoading(false);
    }
  }

  async function saveScanningSettings() {
    const accessToken = session?.access_token;
    if (
      !accessToken
      || !isAdmin
      || isScanningSettingsSaving
      || !scanningModelId.trim()
      || !scanningPrompt.trim()
    ) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsScanningSettingsSaving(true);
    try {
      const response = await fetch("/api/admin/scanning-settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelId: scanningModelId.trim(), prompt: scanningPrompt.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (
        !response.ok
        || typeof payload.modelId !== "string"
        || !payload.modelId.trim()
        || typeof payload.prompt !== "string"
        || !payload.prompt.trim()
        || typeof payload.updatedAt !== "string"
      ) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Die Scanning-Konfiguration konnte nicht gespeichert werden.",
        );
      }
      setScanningModelId(payload.modelId);
      setScanningPrompt(payload.prompt);
      setAdminNotice("Die Scanning-Konfiguration wurde gespeichert und gilt für neue Auswertungen.");
    } catch (settingsError) {
      setAdminError(settingsError instanceof Error
        ? settingsError.message
        : "Die Scanning-Konfiguration konnte nicht gespeichert werden.");
    } finally {
      setIsScanningSettingsSaving(false);
    }
  }

  async function openAdministrationView() {
    const accessToken = session?.access_token;
    if (!isAdmin || !accessToken) {
      return;
    }
    setAppView("administration");
    setAdminTab("scanning");
    setAdminError("");
    setAdminNotice("");
    setIsAdminUsersLoading(true);
    setAdminUserProfile(null);
    void loadScanningSettings(accessToken);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }

    try {
      const usersResponse = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const usersPayload = (await usersResponse.json().catch(() => ({}))) as Record<string, unknown>;
      if (!usersResponse.ok || !Array.isArray(usersPayload.users)) {
        throw new Error(
          typeof usersPayload.error === "string"
            ? usersPayload.error
            : "Benutzer konnten nicht geladen werden.",
        );
      }
      const loadedUsers = usersPayload.users.flatMap((item): AdminUserSummary[] => {
        const loadedUser = normalizeAdminUser(item);
        return loadedUser ? [loadedUser] : [];
      });
      if (loadedUsers.length !== usersPayload.users.length) {
        throw new Error("Die geladenen Benutzerdaten sind ungültig.");
      }
      setAdminUsers(loadedUsers);
    } catch (adminUsersError) {
      setAdminError(adminUsersError instanceof Error
        ? adminUsersError.message
        : "Benutzer konnten nicht geladen werden.");
    } finally {
      setIsAdminUsersLoading(false);
    }
  }

  async function loadAdminUserProfile(userId: string) {
    const accessToken = session?.access_token;
    if (!accessToken || isAdminUserMutationRunning) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUsersLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const profile = normalizeAdminUserProfile(payload);
      if (!response.ok || !profile) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Benutzerprofil konnte nicht geladen werden.",
        );
      }
      setAdminUserProfile(profile);
    } catch (profileError) {
      setAdminError(profileError instanceof Error
        ? profileError.message
        : "Benutzerprofil konnte nicht geladen werden.");
    } finally {
      setIsAdminUsersLoading(false);
    }
  }

  async function createAdminManagedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = session?.access_token;
    if (!accessToken || isAdminUserCreating) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUserCreating(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(adminUserForm),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const createdUser = normalizeAdminUser(payload.user);
      if (!response.ok || !createdUser) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Das Benutzerkonto konnte nicht erstellt werden.",
        );
      }
      setAdminUsers((current) => [...current, createdUser]
        .sort((left, right) => left.email.localeCompare(right.email, "de")));
      setAdminUserForm({ email: "", password: "" });
      setAdminNotice(`Das Benutzerkonto ${createdUser.email} wurde erstellt.`);
      setAdminUserProfile({ user: createdUser, requestCount: 0, requests: [] });
    } catch (createError) {
      setAdminError(createError instanceof Error
        ? createError.message
        : "Das Benutzerkonto konnte nicht erstellt werden.");
    } finally {
      setIsAdminUserCreating(false);
    }
  }

  async function deleteAdminRequestHistory() {
    const accessToken = session?.access_token;
    const profile = adminUserProfile;
    if (!accessToken || !profile || isAdminUserMutationRunning) {
      return;
    }
    if (!window.confirm(
      `Den separaten Anfrageverlauf von ${profile.user.email} wirklich löschen? Die Unterhaltungen bleiben erhalten.`,
    )) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUserMutationRunning(true);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(profile.user.id)}/requests`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Anfrageverlauf konnte nicht gelöscht werden.",
        );
      }
      setAdminUserProfile((current) => current?.user.id === profile.user.id
        ? { ...current, requestCount: 0, requests: [] }
        : current);
      setAdminNotice("Der separate Anfrageverlauf wurde gelöscht. Unterhaltungen bleiben erhalten.");
    } catch (deleteError) {
      setAdminError(deleteError instanceof Error
        ? deleteError.message
        : "Anfrageverlauf konnte nicht gelöscht werden.");
    } finally {
      setIsAdminUserMutationRunning(false);
    }
  }

  async function deleteAdminManagedUser() {
    const accessToken = session?.access_token;
    const profile = adminUserProfile;
    if (
      !accessToken
      || !profile
      || profile.user.id === user?.id
      || isAdminUserMutationRunning
    ) {
      return;
    }
    if (!window.confirm(
      `Das Konto ${profile.user.email} wirklich löschen? Konto, Unterhaltungen und Anfrageverlauf werden dauerhaft entfernt.`,
    )) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUserMutationRunning(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(profile.user.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Das Benutzerkonto konnte nicht gelöscht werden.",
        );
      }
      setAdminUsers((current) => current.filter((entry) => entry.id !== profile.user.id));
      setAdminUserProfile(null);
      setAdminNotice(`Das Benutzerkonto ${profile.user.email} wurde gelöscht.`);
    } catch (deleteError) {
      setAdminError(deleteError instanceof Error
        ? deleteError.message
        : "Das Benutzerkonto konnte nicht gelöscht werden.");
    } finally {
      setIsAdminUserMutationRunning(false);
    }
  }

  function selectVerf5Form() {
    setSelectedFormId(VERF5_FORM_ID);
    setFormImage(null);
    setFormSaldo("");
    setFormError("");
    setFormNotice("");
  }

  function showFormSelection() {
    if (isGeneratingForm) {
      return;
    }
    setSelectedFormId("");
    setFormImage(null);
    setFormSaldo("");
    setFormError("");
    setFormNotice("");
    if (formImageInputRef.current) {
      formImageInputRef.current.value = "";
    }
  }

  function handleFormImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setFormNotice("");

    if (files.length === 0) {
      return;
    }
    if (files.length !== 1) {
      event.target.value = "";
      setFormImage(null);
      setFormError("Bitte genau ein Bild auswählen.");
      return;
    }

    const image = files[0];
    if (!image || !isFormImageMimeType(image.type.toLowerCase())) {
      event.target.value = "";
      setFormImage(null);
      setFormError("Bitte nur JPEG-, PNG- oder WebP-Bilder auswählen.");
      return;
    }
    if (image.size > MAX_FORM_IMAGE_BYTES) {
      event.target.value = "";
      setFormImage(null);
      setFormError("Das Bild ist zu groß. Maximal 5 MB sind erlaubt.");
      return;
    }

    setFormImage(image);
    setFormError("");
  }

  async function handleFormGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGeneratingForm || selectedFormId !== VERF5_FORM_ID) {
      return;
    }
    if (!formImage) {
      setFormError("Bitte ein Bild auswählen.");
      return;
    }

    try {
      normalizeManualSaldo(formSaldo);
    } catch (saldoError) {
      setFormError(saldoError instanceof Error ? saldoError.message : "Der Saldo ist ungültig.");
      return;
    }

    if (!supabase || !user) {
      setFormError("Bitte zuerst anmelden.");
      return;
    }

    setFormError("");
    setFormNotice("");
    setIsGeneratingForm(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      }
      setSession(sessionData.session);

      const formData = new FormData();
      formData.append("formId", VERF5_FORM_ID);
      formData.append("image", formImage, formImage.name);
      formData.append("saldo", formSaldo);

      const response = await fetch("/api/forms/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das Formular konnte nicht erstellt werden.",
        );
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="(Verf5_\d{2}\.\d{2}\.\d{4}\.docx)"/.exec(disposition)?.[1];
      if (!filename) {
        throw new Error("Die Formularantwort war ungültig. Bitte erneut versuchen.");
      }

      const documentBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(documentBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      setFormNotice("Das Formular wurde erstellt und heruntergeladen.");
    } catch (generateError) {
      setFormError(
        generateError instanceof Error
          ? generateError.message
          : "Das Formular konnte nicht erstellt werden.",
      );
    } finally {
      setIsGeneratingForm(false);
    }
  }

  function startNewManagedConversation() {
    openFredView();
  }

  function openScanningView() {
    setAppView("scanning");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  async function selectFredConversation(conversation: ConversationSummary) {
    if (isHistoryLoading || isDeleting || !session?.access_token) {
      return;
    }
    setError("");
    setIsHistoryLoading(true);
    try {
      const history = await fetchFredConversationHistory(session.access_token, conversation.id);
      setAppView("chat");
      setFredConversationId(conversation.id);
      setFredMessages(history.messages);
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
        setSettingsOpen(false);
      }
    } catch (historyError) {
      setError(historyError instanceof Error
        ? historyError.message
        : "Fred-Unterhaltung konnte nicht geladen werden.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function toggleFredConversationSelection(id: string) {
    setSelectedFredConversationIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  }

  function handleFredConversationUpdated(
    conversation: ConversationSummary,
    updatedMessages?: FredNativeMessage[],
  ) {
    setFredConversationId(conversation.id);
    if (updatedMessages) setFredMessages(updatedMessages);
    setFredConversations((current) => [
      conversation,
      ...current.filter((entry) => entry.id !== conversation.id),
    ]);
  }

  async function exportFredConversationPdf(conversation: ConversationSummary): Promise<void> {
    const accessToken = session?.access_token;
    if (
      !accessToken
      || conversation.id !== fredConversationId
      || isDownloadingFredConversationPdf
    ) {
      return;
    }

    setError("");
    setIsDownloadingFredConversationPdf(true);
    try {
      await downloadFredPdfFile({
        accessToken,
        title: conversation.title.trim() || "Fred-Unterhaltung",
        content: buildFredConversationPdfContent(fredMessages),
      });
    } catch (downloadError) {
      setError(downloadError instanceof Error
        ? downloadError.message
        : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setIsDownloadingFredConversationPdf(false);
    }
  }

  async function deleteFredConversations(ids: string[], useBulkEndpoint = false) {
    if (
      ids.length === 0
      || isHistoryLoading
      || isDeleting
      || !session?.access_token
    ) {
      return;
    }

    const confirmed = window.confirm(
      ids.length === 1
        ? "Diese Fred-Unterhaltung wirklich löschen? Alle gespeicherten Nachrichten werden entfernt."
        : `${ids.length} Fred-Unterhaltungen wirklich löschen? Alle gespeicherten Nachrichten werden entfernt.`,
    );
    if (!confirmed) {
      return;
    }

    setError("");
    setIsDeleting(true);
    try {
      const response = await fetch(
        useBulkEndpoint
          ? "/api/fred/conversations"
          : `/api/fred/conversations/${encodeURIComponent(ids[0])}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(useBulkEndpoint ? { "Content-Type": "application/json" } : {}),
          },
          ...(useBulkEndpoint ? { body: JSON.stringify({ ids }) } : {}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Fred-Unterhaltung konnte nicht gelöscht werden.",
        );
      }

      const deletedIds = Array.isArray(payload.deletedIds)
        ? payload.deletedIds.filter((id): id is string => typeof id === "string")
        : [];
      const result = applyConversationDeletion({
        conversations: fredConversations,
        selectedIds: selectedFredConversationIds,
        activeConversationId: fredConversationId,
        deletedIds,
      });
      setFredConversations(result.conversations);
      setSelectedFredConversationIds(result.selectedIds);
      if (result.activeConversationDeleted) {
        openFredView();
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Fred-Unterhaltung konnte nicht gelöscht werden.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  function openSettingsDialog() {
    setAccountDeletionError("");
    setIsSettingsDialogOpen(true);
  }

  async function downloadGermanSvPensionPdf(
    year: GermanSvPensionYear,
    mode: GermanSvPensionMode,
    amount: number,
  ) {
    if (isDownloadingGermanSvPensionPdf) {
      return;
    }
    if (!supabase || !user) {
      setError("Bitte zuerst anmelden.");
      return;
    }

    setError("");
    setIsDownloadingGermanSvPensionPdf(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      }
      setSession(sessionData.session);

      const pdfDocument = buildGermanSvPensionPdfDocument(year, mode, amount);
      const response = await fetch("/api/tools/pdf", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pdfDocument),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das PDF konnte nicht erstellt werden.",
        );
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) {
        throw new Error("Die PDF-Antwort war ungültig. Bitte erneut versuchen.");
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([A-Za-z0-9_.-]+\.pdf)"/.exec(disposition)?.[1]
        ?? `Deutsche_SV_Rente_${year}.pdf`;
      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Das PDF konnte nicht erstellt werden.",
      );
    } finally {
      setIsDownloadingGermanSvPensionPdf(false);
    }
  }

  const isAppReady = isLoaded && isAuthLoaded;
  const isAuthConfigured = isSupabaseBrowserConfigured();
  const historyControlsDisabled = isHistoryLoading || isDeleting;
  const visibleConversations = fredConversations;
  const visibleSelectedConversationIds = selectedFredConversationIds;
  const visibleActiveConversationId = fredConversationId;

  if (!isAuthLoaded) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-card-standalone" aria-label="Anmeldung wird geprüft">
          <p className="eyebrow">findog.at</p>
          <h1>Anmeldung prüfen</h1>
          <p className="auth-copy">Bitte warten...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-card-standalone" aria-label="Anmeldung">
          {/* The supplied Fred asset must remain a regular responsive public image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="fred-login-image"
            src="/fred-login.png"
            alt="Fred liest im Steuerkodex"
          />
          <p className="auth-copy">
            Melde dich mit E-Mail und Passwort an. Der geschützte Bereich öffnet sich erst nach
            erfolgreicher Anmeldung.
          </p>

          {!isAuthConfigured ? (
            <div className="error-box auth-message" role="alert">
              Supabase Auth ist für diese Umgebung noch nicht konfiguriert.
            </div>
          ) : null}
          {authError ? (
            <div className="error-box auth-message" role="alert" aria-live="polite">
              {authError}
            </div>
          ) : null}
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <div className="field-group">
              <label htmlFor="auth-email">E-Mail-Adresse</label>
              <input
                id="auth-email"
                type="email"
                value={authForm.email}
                onChange={(event) => updateAuthForm("email", event.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
                disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
              />
            </div>
            <div className="field-group">
              <label htmlFor="auth-password">Passwort</label>
              <input
                id="auth-password"
                type="password"
                value={authForm.password}
                onChange={(event) => updateAuthForm("password", event.target.value)}
                autoComplete="current-password"
                placeholder="Mindestens 6 Zeichen"
                disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
              />
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
            >
              {isAuthSubmitting ? "Bitte warten..." : "Anmelden"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {settingsOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSettingsOpen(false)}
          aria-hidden="true"
        />
      )}

      {!settingsOpen && (
        <button
          className="mobile-menu-toggle"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Menü öffnen"
          title="Menü öffnen"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
      )}

      <aside className={`sidebar ${settingsOpen ? "expanded" : "collapsed"}`} aria-label="Seitenmenü">
        <div className="sidebar-header">
          {settingsOpen ? (
            <>
              <Link className="sidebar-brand" href="/">
                <span className="austria-flag" aria-hidden="true">
                  <span className="red"></span>
                  <span className="white"></span>
                  <span className="red"></span>
                </span>
                <span className="brand-text">findog.at</span>
                <span className="beta-tag">Beta</span>
              </Link>
              <button
                className="icon-button toggle-sidebar-btn"
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Menü einklappen"
                title="Menü einklappen"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
            </>
          ) : (
            <button
              className="icon-button toggle-sidebar-btn rail-btn"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Menü ausklappen"
              title="Menü ausklappen"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
          )}
        </div>

        {settingsOpen ? (
          <div className="sidebar-content">
            <button
              className="primary-button new-conversation-button"
              type="button"
              onClick={startNewManagedConversation}
              disabled={historyControlsDisabled}
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Neue Unterhaltung
            </button>
            <div
              ref={sidebarSplitRegionRef}
              className={`sidebar-split-region${isSidebarSplitResizing ? " is-resizing" : ""}${
                isApplicationNavigationExpanded ? "" : " applications-collapsed"
              }`}
              style={{
                "--sidebar-history-share": `${sidebarHistoryPercent}%`,
              } as React.CSSProperties}
            >
              <div className="conversation-history" aria-label="Gespeicherte Unterhaltungen">
                <div className="conversation-history-heading">
                  <span>Unterhaltungen</span>
                  {isHistoryLoading || isDeleting ? (
                    <span className="history-loading">{isDeleting ? "Löscht…" : "Lädt…"}</span>
                  ) : null}
                </div>
                <div className="conversation-bulk-actions">
                  <span>{visibleSelectedConversationIds.length} ausgewählt</span>
                  <button
                    className="bulk-delete-button"
                    type="button"
                    onClick={() => void deleteFredConversations(visibleSelectedConversationIds, true)}
                    disabled={historyControlsDisabled || visibleSelectedConversationIds.length === 0}
                  >
                    Auswahl löschen
                  </button>
                </div>
                <div className="conversation-list">
                  {!isHistoryLoading && visibleConversations.length === 0 ? (
                    <p className="conversation-empty">Noch keine gespeicherten Unterhaltungen.</p>
                  ) : null}
                  {visibleConversations.map((conversation) => (
                    <div
                      className={`conversation-row ${conversation.id === visibleActiveConversationId ? "active" : ""}`}
                      key={conversation.id}
                    >
                      <input
                        className="conversation-checkbox"
                        type="checkbox"
                        checked={visibleSelectedConversationIds.includes(conversation.id)}
                        onChange={() => toggleFredConversationSelection(conversation.id)}
                        disabled={historyControlsDisabled}
                        aria-label={`Unterhaltung „${conversation.title}“ auswählen`}
                      />
                      <button
                        className="conversation-open"
                        type="button"
                        onClick={() => void selectFredConversation(conversation)}
                        disabled={historyControlsDisabled}
                        aria-current={conversation.id === visibleActiveConversationId ? "page" : undefined}
                      >
                        <span title={conversation.title}>{conversation.title}</span>
                        <time dateTime={conversation.updatedAt}>{formatHistoryDate(conversation.updatedAt)}</time>
                      </button>
                      <div className="conversation-actions">
                        {conversation.id === visibleActiveConversationId ? (
                          <button
                            className="conversation-export"
                            type="button"
                            onClick={() => void exportFredConversationPdf(conversation)}
                            disabled={historyControlsDisabled || isDownloadingFredConversationPdf}
                            aria-label={`Unterhaltung „${conversation.title}“ als PDF exportieren`}
                            aria-busy={isDownloadingFredConversationPdf}
                            title={isDownloadingFredConversationPdf ? "PDF wird erstellt …" : "Verlauf als PDF"}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v2h14v-2" />
                            </svg>
                          </button>
                        ) : null}
                        <button
                          className="conversation-delete"
                          type="button"
                          onClick={() => void deleteFredConversations([conversation.id])}
                          disabled={historyControlsDisabled}
                          aria-label={`Unterhaltung „${conversation.title}“ löschen`}
                        >
                          Löschen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {isApplicationNavigationExpanded ? (
                <div
                  className="sidebar-split-divider"
                  role="separator"
                  aria-label="Höhe der Unterhaltungshistorie anpassen"
                  aria-orientation="horizontal"
                  aria-valuemin={MIN_SIDEBAR_HISTORY_PERCENT}
                  aria-valuemax={MAX_SIDEBAR_HISTORY_PERCENT}
                  aria-valuenow={sidebarHistoryPercent}
                  tabIndex={0}
                  onPointerDown={handleSidebarSplitPointerDown}
                  onPointerMove={handleSidebarSplitPointerMove}
                  onPointerUp={finishSidebarSplitResize}
                  onPointerCancel={finishSidebarSplitResize}
                  onLostPointerCapture={() => setIsSidebarSplitResizing(false)}
                  onKeyDown={handleSidebarSplitKeyDown}
                />
              ) : null}
              <section className="application-navigation-section">
                <button
                  className="application-navigation-toggle"
                  type="button"
                  onClick={toggleApplicationNavigation}
                  aria-expanded={isApplicationNavigationExpanded}
                  aria-controls="application-navigation"
                >
                  <span>Anwendungsbereiche</span>
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points={isApplicationNavigationExpanded ? "6 9 12 15 18 9" : "9 6 15 12 9 18"}></polyline>
                  </svg>
                </button>
                {isApplicationNavigationExpanded ? (
                  <nav className="forms-navigation"
                    id="application-navigation"
                    aria-label="Anwendungsbereiche"
                  >
              <button
                className={`sidebar-view-button ${appView === "bfg-decisions" ? "active" : ""}`}
                type="button"
                onClick={openBfgDecisionsView}
                aria-current={appView === "bfg-decisions" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line><path d="M8 11h6M11 8v6"></path></svg>
                BFG Suche
              </button>
              <button
                className={`sidebar-view-button ${appView === "bfg-pro" ? "active" : ""}`}
                type="button"
                onClick={openBfgProView}
                aria-current={appView === "bfg-pro" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"></path><path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z"></path></svg>
                BFG Suche PRO
              </button>
              <button
                className={`sidebar-view-button ${appView === "scanning" ? "active" : ""}`}
                type="button"
                onClick={openScanningView}
                aria-current={appView === "scanning" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6" /></svg>
                Scanning
              </button>
              <button
                className={`sidebar-view-button ${appView === "german-sv-pension" ? "active" : ""}`}
                type="button"
                onClick={openGermanSvPensionView}
                aria-current={appView === "german-sv-pension" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"></path></svg>
                Deutsche SV Rente
              </button>
              <button
                className={`sidebar-view-button ${appView === "l17b-currency" ? "active" : ""}`}
                type="button"
                onClick={openL17bCurrencyView}
                aria-current={appView === "l17b-currency" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8"></path></svg>
                L17b Währungsrechner
              </button>
              <button
                className={`sidebar-view-button ${appView === "fredrun" ? "active" : ""}`}
                type="button"
                onClick={openFredRunView}
                aria-current={appView === "fredrun" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17h3l2-4 3 2 2-5 2 4h4"></path><path d="M5 7h.01M9 5h.01M13 7h.01"></path></svg>
                Fredrun
              </button>
              <button
                className={`sidebar-view-button ${appView === "forms" ? "active" : ""}`}
                type="button"
                onClick={openFormsView}
                aria-current={appView === "forms" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
                Formulare
              </button>
              <button
                className={`sidebar-view-button ${appView === "data" ? "active" : ""}`}
                type="button"
                onClick={openDataView}
                aria-current={appView === "data" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path></svg>
                Daten
              </button>
              {isAdmin ? (
                <button
                  className={`sidebar-view-button ${appView === "administration" ? "active" : ""}`}
                  type="button"
                  onClick={() => void openAdministrationView()}
                  aria-current={appView === "administration" ? "page" : undefined}
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
                  Administration
                </button>
              ) : null}
                  </nav>
                ) : null}
              </section>
            </div>
          </div>
        ) : (
          <div className="rail-content">
            <button
              className="icon-button rail-icon-btn"
              type="button"
              onClick={startNewManagedConversation}
              disabled={historyControlsDisabled}
              title="Neue Unterhaltung"
              aria-label="Neue Unterhaltung"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn rail-forms-button ${appView === "forms" ? "active" : ""}`}
              type="button"
              onClick={openFormsView}
              title="Formulare"
              aria-label="Formulare"
              aria-current={appView === "forms" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "data" ? "active" : ""}`}
              type="button"
              onClick={openDataView}
              title="Daten"
              aria-label="Daten"
              aria-current={appView === "data" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "bfg-decisions" ? "active" : ""}`}
              type="button"
              onClick={openBfgDecisionsView}
              title="BFG Suche"
              aria-label="BFG Suche"
              aria-current={appView === "bfg-decisions" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line><path d="M8 11h6M11 8v6"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "bfg-pro" ? "active" : ""}`}
              type="button"
              onClick={openBfgProView}
              title="BFG Suche PRO"
              aria-label="BFG Suche PRO"
              aria-current={appView === "bfg-pro" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"></path><path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "scanning" ? "active" : ""}`}
              type="button"
              onClick={openScanningView}
              title="Scanning"
              aria-label="Scanning"
              aria-current={appView === "scanning" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6" /></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "german-sv-pension" ? "active" : ""}`}
              type="button"
              onClick={openGermanSvPensionView}
              title="Deutsche SV Rente"
              aria-label="Deutsche SV Rente"
              aria-current={appView === "german-sv-pension" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "l17b-currency" ? "active" : ""}`}
              type="button"
              onClick={openL17bCurrencyView}
              title="L17b Währungsrechner"
              aria-label="L17b Währungsrechner"
              aria-current={appView === "l17b-currency" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "fredrun" ? "active" : ""}`}
              type="button"
              onClick={openFredRunView}
              title="Fredrun"
              aria-label="Fredrun"
              aria-current={appView === "fredrun" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17h3l2-4 3 2 2-5 2 4h4"></path><path d="M5 7h.01M9 5h.01M13 7h.01"></path></svg>
            </button>
            {isAdmin ? (
              <button
                className={`icon-button rail-icon-btn rail-forms-button ${appView === "administration" ? "active" : ""}`}
                type="button"
                onClick={() => void openAdministrationView()}
                title="Administration"
                aria-label="Administration"
                aria-current={appView === "administration" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
              </button>
            ) : null}
          </div>
        )}

        <div className="sidebar-footer">
          {settingsOpen ? (
            <>
              <div className="user-profile">
                <span className="user-email-label">Angemeldet als</span>
                <span className="user-email" title={signedInEmail}>{signedInEmail}</span>
              </div>
              <button
                ref={settingsTriggerRef}
                className="secondary-button sidebar-settings-btn"
                type="button"
                onClick={openSettingsDialog}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Einstellungen
              </button>
              <button
                className="secondary-button sidebar-signout-btn"
                type="button"
                onClick={handleSignOut}
                disabled={isAuthSubmitting}
                title="Abmelden"
                aria-label="Abmelden"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Abmelden
              </button>
            </>
          ) : (
            <>
              <button
                ref={settingsTriggerRef}
                className="icon-button rail-icon-btn"
                type="button"
                onClick={openSettingsDialog}
                title="Einstellungen"
                aria-label="Einstellungen"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
              <button
                className="icon-button rail-icon-btn sidebar-signout-btn"
                type="button"
                onClick={handleSignOut}
                disabled={isAuthSubmitting}
                title="Abmelden"
                aria-label="Abmelden"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              </button>
            </>
          )}
        </div>
      </aside>

      {isSettingsDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSettingsDialog();
            }
          }}
        >
          <section
            ref={settingsDialogRef}
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
          >
            <div className="settings-dialog-header">
              <div>
                <p className="eyebrow">Konto</p>
                <h2 id="settings-dialog-title">Einstellungen</h2>
              </div>
              <button
                ref={settingsDialogCloseRef}
                className="icon-button"
                type="button"
                onClick={closeSettingsDialog}
                aria-label="Einstellungen schließen"
                title="Schließen"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>
              </button>
            </div>
            <div className="account-settings-content">
              <section className="account-settings-section" aria-labelledby="password-settings-title">
                <h3 id="password-settings-title">Passwort ändern</h3>
              <form
                className="password-settings-form"
                onSubmit={handlePasswordChange}
              >
                <p className="field-help">
                  Gib dein aktuelles Passwort und ein neues Passwort mit mindestens 6 Zeichen ein.
                </p>
                {passwordChangeError ? (
                  <div className="error-box" role="alert" aria-live="polite">
                    {passwordChangeError}
                  </div>
                ) : null}
                {passwordChangeNotice ? (
                  <div className="notice-box" role="status" aria-live="polite">
                    {passwordChangeNotice}
                  </div>
                ) : null}
                <div className="field-group">
                  <label htmlFor="current-password">Aktuelles Passwort</label>
                  <input
                    id="current-password"
                    type="password"
                    value={passwordChangeForm.currentPassword}
                    onChange={(event) => updatePasswordChangeForm("currentPassword", event.target.value)}
                    autoComplete="current-password"
                    disabled={isPasswordChangeSubmitting}
                    required
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="new-password">Neues Passwort</label>
                  <input
                    id="new-password"
                    type="password"
                    value={passwordChangeForm.newPassword}
                    onChange={(event) => updatePasswordChangeForm("newPassword", event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isPasswordChangeSubmitting}
                    required
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="password-confirmation">Neues Passwort bestätigen</label>
                  <input
                    id="password-confirmation"
                    type="password"
                    value={passwordChangeForm.confirmation}
                    onChange={(event) => updatePasswordChangeForm("confirmation", event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isPasswordChangeSubmitting}
                    required
                  />
                </div>
                <button
                  className="primary-button password-change-button"
                  type="submit"
                  disabled={isPasswordChangeSubmitting}
                >
                  {isPasswordChangeSubmitting ? "Bitte warten..." : "Passwort ändern"}
                </button>
              </form>
              </section>
              <section className="account-settings-section account-deletion-section" aria-labelledby="account-deletion-title">
                <h3 id="account-deletion-title">Konto löschen</h3>
                <p>
                  Löscht dein Konto, alle Unterhaltungen und den Anfrageverlauf dauerhaft.
                  Vor dem Löschen musst du den Vorgang ausdrücklich bestätigen.
                </p>
                {accountDeletionError ? (
                  <div className="error-box" role="alert" aria-live="polite">
                    {accountDeletionError}
                  </div>
                ) : null}
                <button
                  className="secondary-button danger-button account-delete-button"
                  type="button"
                  onClick={() => void deleteOwnAccount()}
                  disabled={isAccountDeletionSubmitting}
                >
                  {isAccountDeletionSubmitting ? "Konto wird gelöscht…" : "Konto dauerhaft löschen"}
                </button>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {appView === "chat" ? (
        <FredNativeChatView
          accessToken={session?.access_token ?? ""}
          conversationId={fredConversationId}
          initialMessages={fredMessages}
          externalError={error}
          renderAssistantContent={(content) => <RichAnswer content={content} />}
          renderUserContent={renderUserMessageContent}
          onConversationUpdated={handleFredConversationUpdated}
        />
      ) : appView === "data" ? (
        <KnowledgeLandscapeView accessToken={session?.access_token ?? ""} />
      ) : appView === "bfg-pro" ? (
        <section className="forms-panel" aria-labelledby="bfg-pro-view-title">
          <div className="forms-view bfg-decisions-view bfg-pro-view">
            <header className="forms-view-header bfg-view-header">
              <div className="bfg-view-header-copy">
                <p className="eyebrow">Findok</p>
                <h1 id="bfg-pro-view-title">BFG Suche PRO</h1>
                <p>KI-gestützte Reihung auf Basis veröffentlichter Findok BFG-Entscheidungen</p>
              </div>
              <Image
                className="bfg-view-header-illustration"
                src="/fred-bfg-pro-search.png"
                alt=""
                width={313}
                height={313}
                unoptimized
              />
            </header>

            <form
              className="bfg-search-form bfg-pro-form"
              onSubmit={(event) => {
                event.preventDefault();
                void searchBfgPro();
              }}
            >
              <label htmlFor="bfg-pro-scenario">Sachverhalt</label>
              <textarea
                id="bfg-pro-scenario"
                value={bfgProScenario}
                onChange={(event) => {
                  setBfgProScenario(event.target.value);
                  setBfgProError("");
                }}
                maxLength={2000}
                rows={7}
                placeholder="Beschreibe den steuerrechtlichen Sachverhalt in eigenen Worten."
                disabled={isSearchingBfgPro}
              />
              <button
                className="primary-button bfg-pro-submit"
                type="submit"
                disabled={isSearchingBfgPro || !bfgProScenario.trim()}
              >
                {isSearchingBfgPro ? "Wird gereiht…" : "Entscheidungen suchen"}
              </button>
            </form>

            {isSearchingBfgPro ? (
              <p className="bfg-pro-loading-state" role="status" aria-live="polite">
                Passende BFG-Entscheidungen werden gesucht und gereiht…
              </p>
            ) : null}

            {bfgProError ? (
              <div className="error-box bfg-message" role="alert" aria-live="polite">{bfgProError}</div>
            ) : null}

            {!bfgProError && !isSearchingBfgPro && bfgProResults?.length === 0 ? (
              <p className="bfg-empty-state">Keine relevanten BFG-Entscheidungen gefunden.</p>
            ) : null}

            {bfgProResults && bfgProResults.length > 0 ? (
              <div className="bfg-results">
                <ol className="bfg-result-list">
                  {bfgProResults.map((result, index) => (
                    <li key={`${result.htmlUrl ?? result.gz}-${index}`}>
                      <article>
                        <h2>{result.title}</h2>
                        <p className="bfg-result-meta">
                          {[
                            result.gz,
                            result.documentType,
                            result.decisionDate
                              ? `Entscheidung vom ${formatBfgPublicationDate(result.decisionDate)}`
                              : result.publicationDate
                                ? `Veröffentlicht am ${formatBfgPublicationDate(result.publicationDate)}`
                                : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                        <div className="bfg-pro-relevance">
                          <h3>Warum relevant</h3>
                          <p>{result.whyRelevant}</p>
                        </div>
                        {result.caseSummary ? (
                          <div className="bfg-pro-excerpt">
                            <h3>Sachverhalt</h3>
                            <p>{result.caseSummary}</p>
                          </div>
                        ) : null}
                        <div className="bfg-result-links">
                          {result.htmlUrl ? (
                            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 5h5v5" />
                                <path d="M10 14 19 5" />
                                <path d="M19 14v5H5V5h5" />
                              </svg>
                              Entscheidung öffnen
                            </a>
                          ) : null}
                          {result.pdfUrl ? (
                            <a href={result.pdfUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                                <path d="M14 2v6h6" />
                              </svg>
                              PDF öffnen
                            </a>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </section>
      ) : appView === "bfg-decisions" ? (
        <section className="forms-panel" aria-labelledby="bfg-decisions-view-title">
          <div className="forms-view bfg-decisions-view">
            <header className="forms-view-header bfg-view-header">
              <div className="bfg-view-header-copy">
                <p className="eyebrow">Findok</p>
                <h1 id="bfg-decisions-view-title">BFG-Entscheidungen</h1>
                <p>Durchsuche veröffentlichte Entscheidungen des Bundesfinanzgerichts in der Findok-Suche über das Suchfeld.</p>
              </div>
              <Image
                className="bfg-view-header-illustration"
                src="/fred-bfg-search.png"
                alt=""
                width={1254}
                height={1254}
                unoptimized
              />
            </header>

            <form
              className="bfg-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                void searchBfgDecisions(1, { sort: bfgSort, filters: bfgFilters });
              }}
            >
              <label htmlFor="bfg-search">Suchbegriff oder Geschäftszahl</label>
              <div className="bfg-search-row">
                <input
                  id="bfg-search"
                  type="search"
                  value={bfgQuery}
                  onChange={(event) => {
                    setBfgQuery(event.target.value);
                    setBfgError("");
                  }}
                  maxLength={200}
                  placeholder="z. B. Umsatzsteuer oder RV/7100930/2024"
                  disabled={isSearchingBfg}
                />
                <button className="primary-button" type="submit" disabled={isSearchingBfg || !bfgQuery.trim()}>
                  {isSearchingBfg ? "Sucht…" : "Suchen"}
                </button>
              </div>
              <div className="bfg-search-controls">
                <select
                  className="bfg-sort-select"
                  aria-label="Sortierung"
                  value={bfgSort}
                  onChange={(event) => setBfgSort(event.target.value as BfgSort)}
                  disabled={isSearchingBfg}
                >
                  {BFG_SORT_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  aria-expanded={isBfgFilterPanelOpen}
                  aria-controls="bfg-filter-panel"
                  onClick={() => setIsBfgFilterPanelOpen((open) => !open)}
                  disabled={isSearchingBfg}
                >
                  Filter
                </button>
              </div>
              {isBfgFilterPanelOpen ? (
                <div className="bfg-filter-panel" id="bfg-filter-panel">
                  <div className="bfg-filter-grid">
                    {bfgPage?.facets.materie.length ? (
                      <label>
                        <span>Materie</span>
                        <select
                          value={bfgFilters.materie}
                          onChange={(event) => updateBfgFilter("materie", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.materie.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.documentType.length ? (
                      <label>
                        <span>Dokumenttyp</span>
                        <select
                          value={bfgFilters.documentType}
                          onChange={(event) => updateBfgFilter("documentType", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.documentType.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.norm.length ? (
                      <label>
                        <span>Norm</span>
                        <select
                          value={bfgFilters.norm}
                          onChange={(event) => updateBfgFilter("norm", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.norm.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.timeframe.length ? (
                      <label>
                        <span>Zeitraum</span>
                        <select
                          value={bfgFilters.timeframe}
                          onChange={(event) => updateBfgFilter("timeframe", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.timeframe.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.withHeadnote.length ? (
                      <label className="bfg-headnote-filter">
                        <input
                          type="checkbox"
                          checked={bfgFilters.withHeadnote}
                          onChange={(event) => updateBfgFilter("withHeadnote", event.target.checked)}
                          disabled={isSearchingBfg}
                        />
                        <span>Mit Rechtssatz</span>
                      </label>
                    ) : null}
                  </div>
                  <div className="bfg-filter-actions">
                    <button
                      className="primary-button compact-button"
                      type="button"
                      onClick={() => {
                        setIsBfgFilterPanelOpen(false);
                        void searchBfgDecisions(1, { sort: bfgSort, filters: bfgFilters });
                      }}
                      disabled={isSearchingBfg || !bfgQuery.trim()}
                    >
                      Anwenden
                    </button>
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={resetBfgFilters}
                      disabled={isSearchingBfg}
                    >
                      Zurücksetzen
                    </button>
                  </div>
                </div>
              ) : null}
            </form>

            {bfgError ? (
              <div className="error-box bfg-message" role="alert" aria-live="polite">{bfgError}</div>
            ) : null}

            {!bfgError && hasSearchedBfg && bfgPage?.results.length === 0 ? (
              <p className="bfg-empty-state">Keine BFG-Entscheidung gefunden.</p>
            ) : null}

            {bfgPage && bfgPage.results.length > 0 ? (
              <div className="bfg-results">
                <p className="bfg-result-count">
                  {bfgPage.totalCount.toLocaleString("de-AT")} {bfgPage.totalCount === 1 ? "Ergebnis" : "Ergebnisse"}
                </p>
                <ol className="bfg-result-list">
                  {bfgPage.results.map((result, index) => (
                    <li key={`${result.htmlUrl ?? result.gz}-${index}`}>
                      <article>
                        <h2>{result.title}</h2>
                        <p className="bfg-result-meta">
                          {[result.gz, result.documentType, result.publicationDate
                            ? `Veröffentlicht am ${formatBfgPublicationDate(result.publicationDate)}`
                            : ""].filter(Boolean).join(" · ")}
                        </p>
                        {result.snippet ? <p className="bfg-result-snippet">{result.snippet}</p> : null}
                        <div className="bfg-result-links">
                          {result.htmlUrl ? (
                            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 5h5v5" />
                                <path d="M10 14 19 5" />
                                <path d="M19 14v5H5V5h5" />
                              </svg>
                              Entscheidung öffnen
                            </a>
                          ) : null}
                          {result.pdfUrl ? (
                            <a href={result.pdfUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                                <path d="M14 2v6h6" />
                              </svg>
                              PDF öffnen
                            </a>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
                {bfgPage.totalPages > 1 ? (
                  <nav className="bfg-pagination" aria-label="Ergebnisseiten">
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => void searchBfgDecisions(bfgPage.page - 1)}
                      disabled={isSearchingBfg || bfgPage.page <= 1}
                    >
                      Zurück
                    </button>
                    <span>Seite {bfgPage.page} von {bfgPage.totalPages}</span>
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => void searchBfgDecisions(bfgPage.page + 1)}
                      disabled={isSearchingBfg || bfgPage.page >= bfgPage.totalPages}
                    >
                      Weiter
                    </button>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : appView === "l17b-currency" ? (
        <L17bCurrencyView />
      ) : appView === "fredrun" ? (
        <FredRunView key={user?.id ?? "fredrun"} accessToken={session?.access_token ?? ""} />
      ) : appView === "scanning" ? (
        <ScanningView accessToken={session?.access_token ?? ""} />
      ) : appView === "german-sv-pension" ? (
        <GermanSvPensionView
          downloadError={error}
          isDownloadingPdf={isDownloadingGermanSvPensionPdf}
          onDownloadPdf={downloadGermanSvPensionPdf}
        />
      ) : appView === "forms" ? (
        <section className="forms-panel" aria-labelledby="forms-view-title">
          <div className="forms-view">
            <header className="forms-view-header">
              <p className="eyebrow">Dokumenterstellung</p>
              <h1 id="forms-view-title">Formulare</h1>
              <p>Wähle ein Formular und erstelle das ausgefüllte Word-Dokument aus einem Bild.</p>
            </header>

            {!selectedFormId ? (
              <div className="form-choice-grid" aria-label="Verfügbare Formulare">
                <button className="form-choice-card" type="button" onClick={selectVerf5Form}>
                  <span className="form-choice-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  </span>
                  <span>
                    <strong>{VERF5_FORM_NAME}</strong>
                    <small>Formular auswählen</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </div>
            ) : (
              <div className="form-generator-card">
                <button
                  className="form-back-button"
                  type="button"
                  onClick={showFormSelection}
                  disabled={isGeneratingForm}
                >
                  <span aria-hidden="true">←</span> Formularauswahl
                </button>
                <div className="form-generator-heading">
                  <h2>{VERF5_FORM_NAME}</h2>
                  <p>Lade ein gut lesbares Bild des Dokuments hoch. Fehlende Werte bleiben im Formular leer.</p>
                </div>

                {formError ? (
                  <div className="error-box" role="alert" aria-live="polite">{formError}</div>
                ) : null}
                {formNotice ? (
                  <div className="form-success-box" role="status" aria-live="polite">{formNotice}</div>
                ) : null}

                <form className="form-generator" onSubmit={handleFormGenerate}>
                  <div className="field-group form-upload-field">
                    <label htmlFor="verf5-image">Bild des Dokuments</label>
                    <input
                      ref={formImageInputRef}
                      id="verf5-image"
                      type="file"
                      accept={FORM_IMAGE_MIME_TYPES.join(",")}
                      onChange={handleFormImageChange}
                      disabled={isGeneratingForm}
                      required
                    />
                    <span className="field-help">JPEG, PNG oder WebP, maximal 5 MB.</span>
                    {formImage ? (
                      <span className="form-selected-file">
                        <span title={formImage.name}>{ellipsizeFilename(formImage.name)}</span>
                        <small>{(formImage.size / 1_048_576).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB</small>
                        <button
                          type="button"
                          onClick={() => {
                            setFormImage(null);
                            if (formImageInputRef.current) {
                              formImageInputRef.current.value = "";
                            }
                          }}
                          disabled={isGeneratingForm}
                          aria-label={`Bild ${formImage.name} entfernen`}
                        >
                          Entfernen
                        </button>
                      </span>
                    ) : null}
                  </div>

                  <div className="field-group">
                    <label htmlFor="verf5-saldo">Saldo am Abgabenkonto per Todestag <span>(optional)</span></label>
                    <input
                      id="verf5-saldo"
                      type="text"
                      inputMode="decimal"
                      value={formSaldo}
                      onChange={(event) => {
                        setFormSaldo(event.target.value);
                        setFormError("");
                        setFormNotice("");
                      }}
                      maxLength={MAX_SALDO_INPUT_CHARS}
                      placeholder="z. B. 1234,56"
                      disabled={isGeneratingForm}
                    />
                    <span className="field-help">Ziffern mit höchstens zwei Dezimalstellen; Komma oder Punkt sind möglich.</span>
                  </div>

                  <button
                    className="primary-button form-generate-button"
                    type="submit"
                    disabled={!formImage || isGeneratingForm || !isAppReady || !user}
                  >
                    {isGeneratingForm ? (
                      <><span className="spinner" aria-hidden="true"></span> Formular wird erstellt…</>
                    ) : (
                      "Formular generieren"
                    )}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>
      ) : appView === "administration" && isAdmin ? (
        <section className="forms-panel" aria-labelledby="administration-view-title">
          <div className="forms-view">
            <header className="forms-view-header">
              <p className="eyebrow">Systemkonfiguration</p>
              <h1 id="administration-view-title">Administration</h1>
            </header>
            {adminError ? (
              <div className="admin-message error-box" role="alert" aria-live="polite">
                {adminError}
              </div>
            ) : null}
            {adminNotice ? (
              <div className="notice-box" role="status" aria-live="polite">
                {adminNotice}
              </div>
            ) : null}
            <div className="admin-tabs" role="tablist" aria-label="Administration">
              <button
                id="admin-tab-scanning"
                className={`admin-tab-button ${adminTab === "scanning" ? "active" : ""}`}
                role="tab"
                aria-selected={adminTab === "scanning"}
                aria-controls="admin-panel-scanning"
                onClick={() => setAdminTab("scanning")}
                onKeyDown={(e) => handleAdminTabKeyDown(e, "scanning")}
              >
                Scanning
              </button>
              <button
                id="admin-tab-benutzer"
                className={`admin-tab-button ${adminTab === "benutzer" ? "active" : ""}`}
                role="tab"
                aria-selected={adminTab === "benutzer"}
                aria-controls="admin-panel-benutzer"
                onClick={() => setAdminTab("benutzer")}
                onKeyDown={(e) => handleAdminTabKeyDown(e, "benutzer")}
              >
                Benutzer
              </button>
            </div>
            {adminTab === "scanning" ? (
              <section className="form-generator-card admin-system-prompt-card" role="tabpanel" id="admin-panel-scanning" aria-labelledby="admin-tab-scanning">
                <div className="form-generator-heading">
                  <h2>Scanning-Einstellungen</h2>
                  <p>OpenRouter-Modell und vollständiger statischer Prompt für die Belegauswertung.</p>
                </div>
                <div className="field-group">
                  <label htmlFor="scanning-model-id">OpenRouter-Modell-ID</label>
                  <input
                    id="scanning-model-id"
                    type="text"
                    value={scanningModelId}
                    onChange={(event) => {
                      setScanningModelId(event.target.value);
                      setAdminError("");
                      setAdminNotice("");
                    }}
                    spellCheck={false}
                    disabled={isScanningSettingsLoading || isScanningSettingsSaving}
                    placeholder="z. B. google/gemini-3.5-flash"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="scanning-prompt">Scanning-Prompt</label>
                  <textarea
                    id="scanning-prompt"
                    className="admin-system-prompt-textarea"
                    value={scanningPrompt}
                    onChange={(event) => {
                      setScanningPrompt(event.target.value);
                      setAdminError("");
                      setAdminNotice("");
                    }}
                    rows={24}
                    spellCheck={false}
                    disabled={isScanningSettingsLoading || isScanningSettingsSaving}
                  />

                </div>
                <div className="admin-model-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void saveScanningSettings()}
                    disabled={
                      isScanningSettingsLoading
                      || isScanningSettingsSaving
                      || !scanningModelId.trim()
                      || !scanningPrompt.trim()
                    }
                  >
                    {isScanningSettingsSaving ? "Wird gespeichert…" : "Scanning-Einstellungen speichern"}
                  </button>
                </div>
              </section>
            ) : (
              <section className="admin-user-management" role="tabpanel" id="admin-panel-benutzer" aria-labelledby="admin-tab-benutzer">
                <div className="form-generator-card admin-create-user-card">
                  <div className="form-generator-heading">
                    <h2>Benutzer anlegen</h2>
                    <p>Erstellt ein bestätigtes Konto für die Anmeldung mit E-Mail und Passwort.</p>
                  </div>
                  <form className="admin-create-user-form" onSubmit={(event) => void createAdminManagedUser(event)}>
                    <div className="field-group">
                      <label htmlFor="admin-user-email">E-Mail</label>
                      <input
                        id="admin-user-email"
                        type="email"
                        autoComplete="off"
                        value={adminUserForm.email}
                        onChange={(event) => setAdminUserForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))}
                        required
                        disabled={isAdminUserCreating}
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="admin-user-password">Passwort</label>
                      <input
                        id="admin-user-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={6}
                        maxLength={72}
                        value={adminUserForm.password}
                        onChange={(event) => setAdminUserForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))}
                        required
                        disabled={isAdminUserCreating}
                      />
                    </div>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={isAdminUserCreating || !adminUserForm.email.trim() || adminUserForm.password.length < 6}
                    >
                      {isAdminUserCreating ? "Wird angelegt…" : "Benutzer anlegen"}
                    </button>
                  </form>
                </div>

                <div className="form-generator-card admin-user-list-card">
                  <div className="form-generator-heading">
                    <h2>Benutzer</h2>
                    <p>{adminUsers.length} Konten</p>
                  </div>
                  {isAdminUsersLoading && adminUsers.length === 0 ? (
                    <p className="admin-empty-state">Benutzer werden geladen…</p>
                  ) : adminUsers.length === 0 ? (
                    <p className="admin-empty-state">Keine Benutzer gefunden.</p>
                  ) : (
                    <ul className="admin-user-list">
                      {adminUsers.map((adminUser) => (
                        <li key={adminUser.id}>
                          <button
                            type="button"
                            className={adminUserProfile?.user.id === adminUser.id ? "active" : undefined}
                            onClick={() => void loadAdminUserProfile(adminUser.id)}
                            disabled={isAdminUsersLoading || isAdminUserMutationRunning}
                          >
                            <strong>{adminUser.email || "Ohne E-Mail"}</strong>
                            <small>Erstellt {formatAdminDate(adminUser.createdAt)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="form-generator-card admin-user-profile-card">
                  <div className="form-generator-heading">
                    <h2>Benutzerprofil</h2>
                    <p>Der Anfrageverlauf enthält ausschließlich Eingaben des Benutzers.</p>
                  </div>
                  {!adminUserProfile ? (
                    <p className="admin-empty-state">Wähle einen Benutzer aus der Liste.</p>
                  ) : (
                    <>
                      <dl className="admin-profile-metadata">
                        <div><dt>E-Mail</dt><dd>{adminUserProfile.user.email || "–"}</dd></div>
                        <div><dt>Erstellt</dt><dd>{formatAdminDate(adminUserProfile.user.createdAt)}</dd></div>
                        <div><dt>Letzte Anmeldung</dt><dd>{formatAdminDate(adminUserProfile.user.lastSignInAt)}</dd></div>
                        <div><dt>Anfragen</dt><dd>{adminUserProfile.requestCount}</dd></div>
                      </dl>
                      <div className="admin-request-history">
                        <h3>Anfrageverlauf</h3>
                        {adminUserProfile.requests.length === 0 ? (
                          <p className="admin-empty-state">Keine protokollierten Anfragen.</p>
                        ) : (
                          <ol>
                            {adminUserProfile.requests.map((entry) => (
                              <li key={entry.id}>
                                <time dateTime={entry.createdAt}>{formatAdminDate(entry.createdAt)}</time>
                                <p>{entry.content}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      <div className="admin-profile-actions">
                        <button
                          className="secondary-button danger-button"
                          type="button"
                          onClick={() => void deleteAdminRequestHistory()}
                          disabled={isAdminUserMutationRunning || adminUserProfile.requestCount === 0}
                        >
                          Anfrageverlauf löschen
                        </button>
                        <button
                          className="secondary-button danger-button"
                          type="button"
                          onClick={() => void deleteAdminManagedUser()}
                          disabled={isAdminUserMutationRunning || adminUserProfile.user.id === user?.id}
                          title={adminUserProfile.user.id === user?.id
                            ? "Das eigene Administratorkonto kann nicht gelöscht werden."
                            : undefined}
                        >
                          Konto löschen
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
