"use client";

import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";

import {
  parseFredNativeStreamLine,
  type FredNativeConversation,
} from "@/lib/fred-native-stream";
import {
  autosizeComposer,
  resetComposerHeight,
} from "@/lib/chat/composer-height";
import { getWelcomeGreeting } from "@/lib/chat/welcome";
import {
  mergeFredResearchStep,
  type FredResearchStep,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";

export type FredNativeMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: FredNativeAttachment[];
  webSearchEnabled?: boolean;
  researchTrace?: FredResearchStep[];
  sourceReferences?: FredSourceReference[];
};

export type FredNativeAttachment = {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
};

type FredCapabilities = { webSearch: boolean; fileUpload: boolean };

const MAX_IMAGE_UPLOADS = 5;
const MAX_FILE_UPLOADS = 5;
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1_024 * 1_024;
const MAX_FILE_UPLOAD_BYTES = 20 * 1_024 * 1_024;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const FILE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".ppt", ".pptx",
]);

type FredNativeChatViewProps = {
  accessToken: string;
  conversationId: string;
  initialMessages: FredNativeMessage[];
  externalError?: string;
  renderAssistantContent: (content: string) => ReactNode;
  renderUserContent: (content: string) => ReactNode;
  onConversationUpdated: (
    conversation: FredNativeConversation,
    messages: FredNativeMessage[],
  ) => void;
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function displayFileSize(bytes: number): string {
  if (bytes < 1_024 * 1_024) return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function fileExtension(name: string): string {
  return /\.[^.]+$/u.exec(name.toLowerCase())?.[0] ?? "";
}

function ResearchTrace({
  steps,
  sources,
  active,
}: {
  steps: FredResearchStep[];
  sources: FredSourceReference[];
  active: boolean;
}) {
  if (steps.length === 0 && sources.length === 0) return null;
  const completed = steps.filter((step) => step.status === "completed").length;
  const summary = active
    ? "Fred recherchiert …"
    : `Rechercheverlauf${completed > 0 ? ` · ${completed} Schritte` : ""}`;
  return (
    <details className="fred-research-trace" open={active}>
      <summary>
        <span className={active ? "fred-research-pulse" : "fred-research-check"} aria-hidden="true" />
        {summary}
      </summary>
      <ol className="fred-research-steps">
        {steps.map((step) => (
          <li className={`is-${step.status}`} key={step.id}>
            <span className="fred-research-status" aria-hidden="true" />
            <span>
              {step.label}
              {step.durationMs !== undefined ? (
                <small>{(step.durationMs / 1_000).toLocaleString("de-AT", { maximumFractionDigits: 1 })} s</small>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {sources.length > 0 ? (
        <div className="fred-research-sources">
          <strong>Gefundene Quellen</strong>
          <div>
            {sources.map((source, index) => source.kind === "web" ? (
              <a href={source.url} target="_blank" rel="noreferrer" key={`web-${source.url}`}>
                {source.title || new URL(source.url).hostname}
              </a>
            ) : (
              <span title={source.chunkId ? `Chunk: ${source.chunkId}` : undefined} key={`kb-${source.knowledgeBaseId ?? ""}-${source.chunkId ?? ""}-${index}`}>
                {source.doc}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </details>
  );
}

export default function FredNativeChatView({
  accessToken,
  conversationId,
  initialMessages,
  externalError = "",
  renderAssistantContent,
  renderUserContent,
  onConversationUpdated,
}: FredNativeChatViewProps) {
  const [messages, setMessages] = useState<FredNativeMessage[]>(initialMessages);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [capabilities, setCapabilities] = useState<FredCapabilities>({
    webSearch: false,
    fileUpload: false,
  });
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());
  const activeConversationIdRef = useRef(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversationId === activeConversationIdRef.current) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeConversationIdRef.current = conversationId;
    setMessages(initialMessages);
    setComposer("");
    setError("");
    setSelectedImages([]);
    setSelectedFiles([]);
    setIsAttachmentMenuOpen(false);
  }, [conversationId, initialMessages]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!attachmentMenuRef.current?.contains(event.target as Node)) {
        setIsAttachmentMenuOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsAttachmentMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void fetch("/api/fred/capabilities", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const value = payload as Record<string, unknown>;
      setCapabilities({
        webSearch: value.webSearch === true,
        fileUpload: value.fileUpload === true,
      });
      if (value.webSearch !== true) setWebSearchEnabled(false);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [accessToken]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    autosizeComposer(textarea);
  }, [composer]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const query = composer.trim();
    if (!query || isSending || !accessToken) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const userMessage: FredNativeMessage = {
      role: "user",
      content: query,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: FredNativeMessage = {
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    const attachedImages = selectedImages;
    const attachedFiles = selectedFiles;
    userMessage.attachments = [
      ...attachedImages.map((file): FredNativeAttachment => ({
        kind: "image",
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      })),
      ...attachedFiles.map((file): FredNativeAttachment => ({
        kind: "file",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      })),
    ];
    userMessage.webSearchEnabled = webSearchEnabled;
    const baseMessages = [...messages, userMessage];
    setMessages([...baseMessages, assistantMessage]);
    setComposer("");
    resetComposerHeight(composerRef.current);
    setSelectedImages([]);
    setSelectedFiles([]);
    setError("");
    setIsSending(true);

    let answer = "";
    let researchTrace: FredResearchStep[] = [];
    let sourceReferences: FredSourceReference[] = [];
    let receivedFinal = false;
    try {
      const requestPayload = {
        query,
        conversationId: activeConversationIdRef.current || undefined,
        webSearchEnabled,
      };
      const hasAttachments = attachedImages.length > 0 || attachedFiles.length > 0;
      const formData = hasAttachments ? new FormData() : null;
      if (formData) {
        formData.append("payload", JSON.stringify(requestPayload));
        for (const file of attachedImages) formData.append("image", file, file.name);
        for (const file of attachedFiles) formData.append("attachment", file, file.name);
      }
      const response = await fetch("/api/fred/chat", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/x-ndjson",
          Authorization: `Bearer ${accessToken}`,
          ...(formData ? {} : { "Content-Type": "application/json" }),
        },
        body: formData ?? JSON.stringify(requestPayload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as unknown;
        throw new Error(responseError(payload, "Fred konnte die Anfrage nicht verarbeiten."));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Der Fred-Antwortstream konnte nicht gelesen werden.");
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        const streamEvent = parseFredNativeStreamLine(line);
        if (!streamEvent) return;
        if (streamEvent.type === "error") throw new Error(streamEvent.error);
        if (streamEvent.type === "conversation") {
          activeConversationIdRef.current = streamEvent.conversation.id;
          onConversationUpdated(streamEvent.conversation, baseMessages);
          return;
        }
        if (streamEvent.type === "delta") {
          answer += streamEvent.content;
          const updatedAssistant = {
            ...assistantMessage,
            content: answer,
            researchTrace,
            sourceReferences,
          };
          setMessages([...baseMessages, updatedAssistant]);
          return;
        }
        if (streamEvent.type === "replace") {
          answer = streamEvent.answer;
          const updatedAssistant = {
            ...assistantMessage,
            content: answer,
            researchTrace,
            sourceReferences,
          };
          setMessages([...baseMessages, updatedAssistant]);
          return;
        }
        if (streamEvent.type === "status") {
          const updatedAssistant = {
            ...assistantMessage,
            content: streamEvent.label,
            researchTrace,
            sourceReferences,
          };
          setMessages([...baseMessages, updatedAssistant]);
          return;
        }
        if (streamEvent.type === "research") {
          researchTrace = mergeFredResearchStep(researchTrace, streamEvent.step);
          const updatedAssistant = {
            ...assistantMessage,
            content: answer,
            researchTrace,
            sourceReferences,
          };
          setMessages([...baseMessages, updatedAssistant]);
          return;
        }
        answer = streamEvent.answer;
        researchTrace = streamEvent.researchTrace ?? researchTrace;
        sourceReferences = streamEvent.sourceReferences ?? sourceReferences;
        receivedFinal = true;
        activeConversationIdRef.current = streamEvent.conversation.id;
        const completedMessages = [
          ...baseMessages,
          {
            ...assistantMessage,
            content: streamEvent.answer,
            researchTrace,
            sourceReferences,
          },
        ];
        setMessages(completedMessages);
        onConversationUpdated(streamEvent.conversation, completedMessages);
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
      if (!answer.trim()) throw new Error("Fred hat keine Antwort geliefert.");
      if (!receivedFinal) throw new Error("Der Fred-Antwortstream wurde ohne Abschluss beendet.");
    } catch (sendError) {
      if (!controller.signal.aborted) {
        setError(sendError instanceof Error
          ? sendError.message
          : "Fred konnte die Anfrage nicht abschließen.");
      }
      if (!answer) setMessages(baseMessages);
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsSending(false);
    }
  }

  function addImageFiles(files: File[]) {
    if (files.length === 0) return;
    if (selectedImages.length + files.length > MAX_IMAGE_UPLOADS) {
      setError("Bitte maximal fünf Bilder pro Anfrage auswählen.");
      return;
    }
    if (files.some((file) => !IMAGE_MIME_TYPES.has(file.type))) {
      setError("Erlaubt sind JPEG-, PNG-, GIF- und WebP-Bilder.");
      return;
    }
    if (files.some((file) => file.size < 1 || file.size > MAX_IMAGE_UPLOAD_BYTES)) {
      setError("Ein Bild darf nicht leer und maximal 10 MB groß sein.");
      return;
    }
    setError("");
    setSelectedImages((current) => [...current, ...files]);
  }

  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setIsAttachmentMenuOpen(false);
    addImageFiles(files);
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setIsAttachmentMenuOpen(false);
    if (selectedFiles.length + files.length > MAX_FILE_UPLOADS) {
      setError("Bitte maximal fünf Dateien pro Anfrage auswählen.");
      return;
    }
    if (files.some((file) => !FILE_EXTENSIONS.has(fileExtension(file.name)))) {
      setError("Erlaubt sind PDF-, Word-, Text-, Markdown-, CSV-, Excel- und PowerPoint-Dateien.");
      return;
    }
    if (files.some((file) => file.size < 1 || file.size > MAX_FILE_UPLOAD_BYTES)) {
      setError("Eine Datei darf nicht leer und maximal 20 MB groß sein.");
      return;
    }
    setError("");
    setSelectedFiles((current) => [...current, ...files]);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (isSending || !capabilities.fileUpload) return;
    const images = Array.from(event.clipboardData.items).flatMap((item) => {
      if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    });
    addImageFiles(images);
  }

  function stopAnswer() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className={`chat-panel ${messages.length === 0 ? "empty-chat" : ""}`} aria-label="Fred">
      <div className="chat-content-group">
        <div className="transcript" ref={transcriptRef} aria-live="polite">
          <div className="transcript-content">
            {messages.length === 0 ? (
              <div className="empty-state">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="fred-welcome-image"
                  src="/fred.png"
                  alt="Fred, der Findog-Steuerassistent"
                />
                <h1 className="welcome-greeting">{welcomeGreeting}</h1>
              </div>
            ) : messages.map((message, index) => (
              <article
                className={`message ${message.role}${isSending && index === messages.length - 1 ? " pending" : ""}`}
                key={`${message.createdAt}-${index}`}
              >
                <div className="message-header">
                  {message.role === "user" ? (
                    <div className="message-avatar">DU</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="message-avatar fred-avatar" src="/fred-avatar.png" alt="" />
                  )}
                  <div className="message-meta">
                    <span className="sender-name">{message.role === "user" ? "Du" : "Fred"}</span>
                    <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                  </div>
                </div>
                {message.role === "assistant" ? (
                  <ResearchTrace
                    steps={message.researchTrace ?? []}
                    sources={message.sourceReferences ?? []}
                    active={isSending && index === messages.length - 1}
                  />
                ) : null}
                {message.role === "assistant"
                  ? (message.content
                    ? renderAssistantContent(message.content)
                    : (
                      <div className="fred-thinking-indicator" role="status" aria-label="Fred denkt nach">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/fred-sniff.gif" alt="" />
                      </div>
                    ))
                  : renderUserContent(message.content)}
                {message.role === "user" && (message.attachments?.length || message.webSearchEnabled) ? (
                  <div className="fred-native-message-options">
                    {message.webSearchEnabled ? (
                      <span className="fred-native-option-badge">Websuche</span>
                    ) : null}
                    {message.attachments?.map((attachment, attachmentIndex) => (
                      <span
                        className="fred-native-option-badge"
                        key={`${attachment.name}-${attachmentIndex}`}
                        title={`${attachment.mimeType} · ${displayFileSize(attachment.sizeBytes)}`}
                      >
                        {attachment.kind === "image" ? "Bild" : "Datei"}: {attachment.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        <div className="composer-container">
          {error || externalError ? (
            <div className="error-box composer-error" role="alert">{error || externalError}</div>
          ) : null}
          <form className="composer" onSubmit={(event) => void sendMessage(event)}>
            <input
              ref={imageInputRef}
              className="fred-native-file-input"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              onChange={addImages}
              tabIndex={-1}
            />
            <input
              ref={fileInputRef}
              className="fred-native-file-input"
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.ppt,.pptx,application/pdf,text/plain"
              multiple
              onChange={addFiles}
              tabIndex={-1}
            />
            <textarea
              ref={composerRef}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              placeholder="Frage zu BFG, EStG, UStG oder Verfahrensrecht..."
              aria-label="Nachricht an Fred"
              disabled={isSending || !accessToken}
              rows={1}
            />
            <div className="composer-toolbar">
              {capabilities.fileUpload ? (
                <div className="composer-menu-control" ref={attachmentMenuRef}>
                  <button
                    className="composer-icon-button"
                    type="button"
                    aria-label="Anhänge hinzufügen"
                    aria-haspopup="menu"
                    aria-expanded={isAttachmentMenuOpen}
                    aria-controls="fred-composer-attachment-menu"
                    disabled={isSending}
                    onClick={() => setIsAttachmentMenuOpen((current) => !current)}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                  {isAttachmentMenuOpen && !isSending ? (
                    <div
                      className="composer-popover attachment-menu"
                      id="fred-composer-attachment-menu"
                      role="menu"
                      aria-label="Anhang auswählen"
                    >
                      <button type="button" role="menuitem" onClick={() => imageInputRef.current?.click()}>
                        <span>Bild anhängen</span>
                        <small className="attachment-menu-limit">max. {MAX_IMAGE_UPLOADS} · je 10 MB</small>
                      </button>
                      <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>
                        <span>Datei anhängen</span>
                        <small className="attachment-menu-limit">max. {MAX_FILE_UPLOADS} · je 20 MB</small>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : <span />}
              <div className="composer-actions">
                {capabilities.webSearch ? (
                  <button
                    className={`composer-model-trigger fred-web-search-toggle${webSearchEnabled ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={webSearchEnabled}
                    onClick={() => setWebSearchEnabled((current) => !current)}
                    disabled={isSending}
                  >
                    <svg className="fred-web-search-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3c2.3 2.45 3.5 5.45 3.5 9s-1.2 6.55-3.5 9M12 3c-2.3 2.45-3.5 5.45-3.5 9s1.2 6.55 3.5 9" />
                    </svg>
                    <span>{webSearchEnabled ? "Websuche aktiv" : "Websuche"}</span>
                  </button>
                ) : null}
                {isSending ? (
                  <button className="secondary-button compact-button" type="button" onClick={stopAnswer}>
                    Stoppen
                  </button>
                ) : null}
                <button
                  className="composer-send-button"
                  type="submit"
                  disabled={!composer.trim() || isSending || !accessToken}
                >
                  {isSending ? (
                    <><span className="spinner" aria-hidden="true" /> Senden...</>
                  ) : (
                    <>
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                      Senden
                    </>
                  )}
                </button>
              </div>
            </div>
            {selectedImages.length > 0 || selectedFiles.length > 0 ? (
              <div className="attachment-chips">
                {selectedImages.map((file, index) => (
                  <span className="attachment-chip image" key={`image-${file.name}-${index}`}>
                    <span title={file.name}>{file.name}</span>
                    <small>{displayFileSize(file.size)}</small>
                    <button
                      type="button"
                      onClick={() => setSelectedImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`Bild ${file.name} entfernen`}
                      disabled={isSending}
                    >
                      Entfernen
                    </button>
                  </span>
                ))}
                {selectedFiles.map((file, index) => (
                  <span className="attachment-chip" key={`file-${file.name}-${index}`}>
                    <span title={file.name}>{file.name}</span>
                    <small>{displayFileSize(file.size)}</small>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`Datei ${file.name} entfernen`}
                      disabled={isSending}
                    >
                      Entfernen
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}
