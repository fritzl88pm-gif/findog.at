"use client";

import Image from "next/image";
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  parseFredNativeStreamLine,
  type FredNativeConversation,
} from "@/lib/fred-native-stream";
import { getWelcomeGreeting } from "@/lib/chat/welcome";

export type FredNativeMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: FredNativeAttachment[];
  webSearchEnabled?: boolean;
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
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());
  const activeConversationIdRef = useRef(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (conversationId === activeConversationIdRef.current) return;
    activeConversationIdRef.current = conversationId;
    setMessages(initialMessages);
    setComposer("");
    setError("");
    setSelectedImages([]);
    setSelectedFiles([]);
  }, [conversationId, initialMessages]);

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
    setSelectedImages([]);
    setSelectedFiles([]);
    setError("");
    setIsSending(true);

    let answer = "";
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
          const updatedAssistant = { ...assistantMessage, content: answer };
          setMessages([...baseMessages, updatedAssistant]);
          return;
        }
        answer = streamEvent.answer;
        receivedFinal = true;
        activeConversationIdRef.current = streamEvent.conversation.id;
        const completedMessages = [
          ...baseMessages,
          { ...assistantMessage, content: streamEvent.answer },
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

  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
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

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
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
    <section className="fred-native-panel" aria-label="Fred">
      <header className="fred-embed-hero">
        <Image
          className="fred-embed-hero-image"
          src="/fred.png"
          alt="Fred, der Findog-Assistent"
          width={380}
          height={380}
          priority
        />
        <h1 className="fred-embed-greeting">{welcomeGreeting}</h1>
      </header>

      <div className="fred-native-chat-shell">
        <div className="transcript fred-native-transcript" ref={transcriptRef} aria-live="polite">
          <div className="transcript-content">
            {messages.length === 0 ? (
              <div className="fred-native-empty">
                <p>Frag Fred zu österreichischem Steuerrecht und den verfügbaren Rechtsquellen.</p>
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
                {message.role === "assistant"
                  ? (message.content
                    ? renderAssistantContent(message.content)
                    : <p className="message-body">Fred denkt nach …</p>)
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

        <div className="composer-container fred-native-composer-container">
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
            {selectedImages.length > 0 || selectedFiles.length > 0 ? (
              <div className="attachment-chips">
                {selectedImages.map((file, index) => (
                  <span className="attachment-chip" key={`image-${file.name}-${index}`}>
                    <span title={file.name}>Bild: {file.name}</span>
                    <small>{displayFileSize(file.size)}</small>
                    <button
                      type="button"
                      onClick={() => setSelectedImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`${file.name} entfernen`}
                    >
                      Entfernen
                    </button>
                  </span>
                ))}
                {selectedFiles.map((file, index) => (
                  <span className="attachment-chip" key={`file-${file.name}-${index}`}>
                    <span title={file.name}>Datei: {file.name}</span>
                    <small>{displayFileSize(file.size)}</small>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`${file.name} entfernen`}
                    >
                      Entfernen
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Frag Fred …"
              aria-label="Nachricht an Fred"
              disabled={isSending || !accessToken}
              rows={2}
            />
            <div className="composer-toolbar">
              <div className="fred-native-composer-tools">
                {capabilities.fileUpload ? (
                  <>
                    <button
                      className="fred-native-tool-button"
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isSending}
                    >
                      Bild
                    </button>
                    <button
                      className="fred-native-tool-button"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSending}
                    >
                      Datei
                    </button>
                  </>
                ) : null}
                {capabilities.webSearch ? (
                  <button
                    className={`fred-native-tool-button${webSearchEnabled ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={webSearchEnabled}
                    onClick={() => setWebSearchEnabled((current) => !current)}
                    disabled={isSending}
                  >
                    Websuche
                  </button>
                ) : null}
                <span className="fred-native-composer-note">Enter zum Senden · Shift + Enter für neue Zeile</span>
              </div>
              <div className="composer-actions">
                {isSending ? (
                  <button className="secondary-button" type="button" onClick={stopAnswer}>
                    Stoppen
                  </button>
                ) : null}
                <button
                  className="composer-send-button"
                  type="submit"
                  disabled={!composer.trim() || isSending || !accessToken}
                >
                  Senden
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
