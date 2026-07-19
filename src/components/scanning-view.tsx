"use client";

import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import RichAnswer from "@/components/rich-answer";
import {
  MAX_SCANNING_IMAGE_BYTES,
  MAX_SCANNING_IMAGES,
  MAX_SCANNING_INSTRUCTIONS_CHARS,
  MAX_SCANNING_PDF_BYTES,
  MAX_SCANNING_PDFS,
  SCANNING_IMAGE_MIME_TYPES,
} from "@/lib/scanning/config";
import { parseScanningStreamLine } from "@/lib/scanning/stream";
import type { ScanningFileStatus, ScanningProgressStage } from "@/lib/scanning/types";

type SubmittedFile = { name: string; kind: "image" | "pdf"; size: number };

function displayFileSize(bytes: number): string {
  return `${(bytes / (1_024 * 1_024)).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB`;
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function progressLabel(stage: ScanningProgressStage, completed: number, total: number, fileName?: string): string {
  if (stage === "validating") return "Dateien werden geprüft …";
  if (stage === "organizing") return "Ergebnisse werden geordnet und summiert …";
  return fileName
    ? `${fileName} wird ausgelesen · ${completed}/${total}`
    : `Dokumente werden ausgelesen · ${completed}/${total}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function ScanningView({ accessToken }: { accessToken: string }) {
  const [images, setImages] = useState<File[]>([]);
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [submittedFiles, setSubmittedFiles] = useState<SubmittedFile[]>([]);
  const [instructions, setInstructions] = useState("");
  const [submittedInstructions, setSubmittedInstructions] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [report, setReport] = useState("");
  const [statuses, setStatuses] = useState<ScanningFileStatus[]>([]);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState("Bereit zur Auswertung");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (submittedFiles.length > 0) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [progress, report, submittedFiles.length]);

  function addFiles(candidates: File[]) {
    const nextImages = candidates.filter((file) => SCANNING_IMAGE_MIME_TYPES.has(file.type.toLowerCase()));
    const nextPdfs = candidates.filter((file) => file.type.toLowerCase() === "application/pdf");
    const unsupported = candidates.length - nextImages.length - nextPdfs.length;
    if (unsupported > 0) {
      setError("Erlaubt sind JPEG-, PNG-, WebP- und GIF-Bilder sowie PDF-Dateien.");
      return;
    }
    if (images.length + nextImages.length > MAX_SCANNING_IMAGES) {
      setError("Bitte maximal fünf Bilder auswählen.");
      return;
    }
    if (pdfs.length + nextPdfs.length > MAX_SCANNING_PDFS) {
      setError("Bitte maximal fünf PDFs auswählen.");
      return;
    }
    if (nextImages.some((file) => file.size <= 0 || file.size > MAX_SCANNING_IMAGE_BYTES)) {
      setError("Ein Bild darf nicht leer und maximal 5 MB groß sein.");
      return;
    }
    if (nextPdfs.some((file) => file.size <= 0 || file.size > MAX_SCANNING_PDF_BYTES)) {
      setError("Ein PDF darf nicht leer und maximal 10 MB groß sein.");
      return;
    }
    setImages((current) => [...current, ...nextImages]);
    setPdfs((current) => [...current, ...nextPdfs]);
    setError("");
  }

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function selectPdfs(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (!isProcessing) addFiles(Array.from(event.dataTransfer.files));
  }

  async function runScanning(event?: FormEvent) {
    event?.preventDefault();
    if (!accessToken || isProcessing || images.length + pdfs.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const submitted: SubmittedFile[] = [
      ...images.map((file) => ({ name: file.name, kind: "image" as const, size: file.size })),
      ...pdfs.map((file) => ({ name: file.name, kind: "pdf" as const, size: file.size })),
    ];
    const formData = new FormData();
    for (const image of images) formData.append("image", image, image.name);
    for (const pdf of pdfs) formData.append("pdf", pdf, pdf.name);
    const normalizedInstructions = instructions.trim();
    if (normalizedInstructions) formData.append("instructions", normalizedInstructions);
    setSubmittedFiles(submitted);
    setSubmittedInstructions(normalizedInstructions);
    setSubmittedAt(new Date().toISOString());
    setReport("");
    setStatuses([]);
    setError("");
    setIsProcessing(true);
    setProgress("Dateien werden hochgeladen …");
    try {
      const response = await fetch("/api/scanning", {
        method: "POST",
        headers: { Accept: "application/x-ndjson", Authorization: `Bearer ${accessToken}` },
        body: formData,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as unknown;
        throw new Error(responseError(payload, "Die Scanning-Anfrage konnte nicht verarbeitet werden."));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Der Scanning-Antwortstream konnte nicht gelesen werden.");
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedFinal = false;
      const processLine = (line: string) => {
        const streamEvent = parseScanningStreamLine(line);
        if (!streamEvent) return;
        if (streamEvent.type === "error") throw new Error(streamEvent.error);
        if (streamEvent.type === "progress") {
          setProgress(progressLabel(
            streamEvent.stage,
            streamEvent.completed,
            streamEvent.total,
            streamEvent.fileName,
          ));
          return;
        }
        receivedFinal = true;
        setReport(streamEvent.report);
        setStatuses(streamEvent.files);
        setProgress("Auswertung abgeschlossen");
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      processLine(buffer);
      if (!receivedFinal) throw new Error("Die Scanning-Auswertung wurde ohne Ergebnis beendet.");
    } catch (scanError) {
      if (!controller.signal.aborted) {
        setError(scanError instanceof Error ? scanError.message : "Die Scanning-Auswertung ist fehlgeschlagen.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsProcessing(false);
    }
  }

  function stopScanning() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsProcessing(false);
    setProgress("Auswertung abgebrochen");
  }

  function resetScanning() {
    abortRef.current?.abort();
    setImages([]);
    setPdfs([]);
    setInstructions("");
    setSubmittedInstructions("");
    setSubmittedFiles([]);
    setSubmittedAt("");
    setReport("");
    setStatuses([]);
    setError("");
    setProgress("Bereit zur Auswertung");
    setIsProcessing(false);
  }

  async function downloadPdf() {
    if (!report || isDownloading) return;
    setIsDownloading(true);
    setError("");
    try {
      const response = await fetch("/api/tools/pdf", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Scanning-Auswertung", content: report }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as unknown;
        throw new Error(responseError(payload, "Das PDF konnte nicht erstellt werden."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = /filename="([^"]+\.pdf)"/iu.exec(response.headers.get("content-disposition") ?? "")?.[1]
        ?? "Scanning-Auswertung.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setIsDownloading(false);
    }
  }

  const hasSubmission = submittedFiles.length > 0;
  return (
    <section className={`chat-panel scanning-panel ${hasSubmission ? "" : "empty-chat"}`} aria-label="Scanning">
      <div className="chat-content-group">
        <div className="transcript" ref={transcriptRef} aria-live="polite">
          <div className="transcript-content">
            {!hasSubmission ? (
              <div className="empty-state scanning-empty-state">
                <div className="scanning-empty-icon" aria-hidden="true">
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6" /></svg>
                </div>
                <div>
                  <h1 className="welcome-greeting">Rechnungen und Belege übersichtlich auswerten</h1>
                  <p>Bis zu fünf Bilder und fünf PDFs werden kategorisiert, chronologisch geordnet und summiert.</p>
                </div>
              </div>
            ) : (
              <>
                <article className="message user">
                  <div className="message-header">
                    <div className="message-avatar">DU</div>
                    <div className="message-meta"><span className="sender-name">Du</span><time dateTime={submittedAt}>{formatTime(submittedAt)}</time></div>
                  </div>
                  <p className="message-body">Bitte diese Dokumente auswerten:</p>
                  <div className="fred-native-message-options">
                    {submittedFiles.map((file, index) => (
                      <span className="fred-native-option-badge" key={`${file.name}-${index}`} title={displayFileSize(file.size)}>
                        {file.kind === "image" ? "Bild" : "PDF"}: {file.name}
                      </span>
                    ))}
                  </div>
                  {submittedInstructions ? (
                    <p className="scanning-submitted-instructions">
                      <strong>Zusätzliche Anweisung:</strong> {submittedInstructions}
                    </p>
                  ) : null}
                </article>
                <article className={`message assistant${isProcessing ? " pending" : ""}`}>
                  <div className="message-header">
                    <div className="message-avatar scanning-avatar" aria-hidden="true">SC</div>
                    <div className="message-meta"><span className="sender-name">Scanning</span><time dateTime={submittedAt}>{formatTime(submittedAt)}</time></div>
                  </div>
                  {report ? (
                    <RichAnswer content={report} />
                  ) : (
                    <p className="message-body scanning-progress">
                      {isProcessing ? <span className="spinner" aria-hidden="true" /> : null}
                      {progress}
                    </p>
                  )}
                  {statuses.length > 0 ? (
                    <div className="scanning-status-summary">
                      {statuses.filter((status) => status.status !== "completed").map((status) => (
                        <span key={status.id}>{status.name}: {status.status === "duplicate" ? "Doppelte Datei" : "Nicht ausgewertet"}</span>
                      ))}
                    </div>
                  ) : null}
                  {report ? (
                    <div className="scanning-result-actions">
                      <button className="secondary-button compact-button scanning-pdf-button" type="button" onClick={() => void downloadPdf()} disabled={isDownloading}>
                        {isDownloading ? "PDF wird erstellt …" : "Als PDF herunterladen"}
                      </button>
                      <button className="primary-button compact-button" type="button" onClick={resetScanning}>Neue Auswertung</button>
                    </div>
                  ) : null}
                </article>
              </>
            )}
          </div>
        </div>

        {!report ? (
          <div className="composer-container scanning-composer-container">
            {error ? <div className="error-box composer-error" role="alert">{error}</div> : null}
            <form className="composer scanning-composer" onSubmit={(event) => void runScanning(event)}>
              <input ref={imageInputRef} className="fred-native-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={selectImages} />
              <input ref={pdfInputRef} className="fred-native-file-input" type="file" accept="application/pdf,.pdf" multiple onChange={selectPdfs} />
              <div
                className={`scanning-dropzone${isDragging ? " is-dragging" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); if (!isProcessing) setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
                onDrop={handleDrop}
              >
                <strong>Dateien hier ablegen</strong>
                <span>oder über die Schaltflächen auswählen</span>
                <small>Bilder bis 5 MB · PDFs bis 10 MB</small>
                <small className="scanning-selection-count">
                  Ausgewählt: {images.length}/{MAX_SCANNING_IMAGES} Bilder · {pdfs.length}/{MAX_SCANNING_PDFS} PDFs
                </small>
              </div>
              <label className="scanning-instructions-field">
                <span>Zusätzliche Anweisungen <small>(optional)</small></span>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  maxLength={MAX_SCANNING_INSTRUCTIONS_CHARS}
                  rows={2}
                  placeholder="z. B. nur Apothekenrechnungen, nur Büromaterialien oder nur Amazon-Rechnungen"
                  disabled={isProcessing}
                  aria-describedby="scanning-instructions-limit"
                />
                <small id="scanning-instructions-limit">
                  {instructions.length}/{MAX_SCANNING_INSTRUCTIONS_CHARS.toLocaleString("de-AT")} Zeichen
                </small>
              </label>
              <div className="composer-toolbar scanning-toolbar">
                <div className="scanning-file-buttons">
                  <button className="secondary-button compact-button" type="button" onClick={() => imageInputRef.current?.click()} disabled={isProcessing || images.length >= MAX_SCANNING_IMAGES}>Bilder auswählen</button>
                  <button className="secondary-button compact-button" type="button" onClick={() => pdfInputRef.current?.click()} disabled={isProcessing || pdfs.length >= MAX_SCANNING_PDFS}>PDFs auswählen</button>
                </div>
                <div className="composer-actions">
                  {isProcessing ? <button className="secondary-button compact-button" type="button" onClick={stopScanning}>Abbrechen</button> : null}
                  <button className="composer-send-button" type="submit" disabled={isProcessing || !accessToken || images.length + pdfs.length === 0}>
                    {isProcessing ? <><span className="spinner" aria-hidden="true" /> Auswertung läuft …</> : "Auswerten"}
                  </button>
                </div>
              </div>
              {images.length + pdfs.length > 0 ? (
                <div className="attachment-chips">
                  {images.map((file, index) => (
                    <span className="attachment-chip image" key={`image-${file.name}-${index}`}>
                      <span title={file.name}>{file.name}</span><small>{displayFileSize(file.size)}</small>
                      <button type="button" disabled={isProcessing} onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Entfernen</button>
                    </span>
                  ))}
                  {pdfs.map((file, index) => (
                    <span className="attachment-chip" key={`pdf-${file.name}-${index}`}>
                      <span title={file.name}>{file.name}</span><small>{displayFileSize(file.size)}</small>
                      <button type="button" disabled={isProcessing} onClick={() => setPdfs((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Entfernen</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </form>
          </div>
        ) : error ? <div className="composer-container"><div className="error-box composer-error" role="alert">{error}</div></div> : null}
      </div>
    </section>
  );
}
