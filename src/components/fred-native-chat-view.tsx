"use client";

import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import CopyIconButton, { copyToClipboard } from "@/components/copy-icon-button";
import {
  findNearestPrecedingUserMessage,
  MAX_AGENT_FEEDBACK_CHARS,
} from "@/lib/agent-feedback";
import { createStreamingTextBuffer } from "@/lib/chat/streaming-text-buffer";
import {
  parseFredNativeStreamLine,
  type FredNativeConversation,
} from "@/lib/fred-native-stream";
import {
  autosizeComposer,
  resetComposerHeight,
} from "@/lib/chat/composer-height";
import {
  messagesBeforeRegeneratedAnswer,
  precedingUserMessage,
} from "@/lib/chat/fred-actions";
import { downloadFredPdfFile } from "@/lib/chat/pdf-download";
import { getWelcomeGreeting } from "@/lib/chat/welcome";
import {
  MAX_REASONING_CATEGORY_NAME_CHARS,
  MAX_REASONING_CONTENT_CHARS,
  MAX_REASONING_TITLE_CHARS,
  orderReasoningCategories,
  reasoningCategoryLabel,
} from "@/lib/reasonings";
import {
  mergeFredResearchStep,
  type FredResearchStep,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";
import {
  fredAgentName,
  type FredAgentKey,
} from "@/lib/weknora/fred-agent";

export type FredNativeMessage = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  agentKey: FredAgentKey;
  attachments?: FredNativeAttachment[];
  webSearchEnabled?: boolean;
  proModeEnabled?: boolean;
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

type FredCapabilities = {
  webSearch: boolean;
  fileUpload: boolean;
  proMode: boolean;
};

type ReasoningCategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
};

type ReasoningContextMenu = {
  text: string;
  left: number;
  top: number;
};

type ReasoningSaveDraft = {
  text: string;
  title: string;
  categoryMode: "existing" | "new";
  categoryId: string;
  newCategoryName: string;
};

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
  readOnly?: boolean;
  readOnlyNotice?: string;
  telegramBotUrl?: string;
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

function categoryOption(value: unknown): ReasoningCategoryOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const category = value as Record<string, unknown>;
  if (typeof category.id !== "string" || typeof category.name !== "string") return null;
  return {
    id: category.id,
    name: category.name,
    parentId: typeof category.parentId === "string" ? category.parentId : null,
  };
}

function categoryOptions(payload: unknown): ReasoningCategoryOption[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const categories = (payload as Record<string, unknown>).categories;
  if (!Array.isArray(categories)) return [];
  const normalized = categories.flatMap((category) => {
    const option = categoryOption(category);
    return option ? [option] : [];
  });
  return orderReasoningCategories(normalized);
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
  agentName,
}: {
  steps: FredResearchStep[];
  sources: FredSourceReference[];
  active: boolean;
  agentName: "Fred" | "QuickFred";
}) {
  if (steps.length === 0 && sources.length === 0) return null;
  const completed = steps.filter((step) => step.status === "completed").length;
  const summary = active
    ? `${agentName} recherchiert …`
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

type StreamingAssistantPreviewHandle = {
  append: (text: string) => void;
  replace: (text: string) => void;
  setStatus: (text: string) => void;
  flush: () => void;
  cancel: () => void;
};

const StreamingAssistantPreview = forwardRef<
  StreamingAssistantPreviewHandle,
  {
    agentName: "Fred" | "QuickFred";
    onGrowth: () => void;
  }
>(function StreamingAssistantPreview({ agentName, onGrowth }, ref) {
  const textContainerRef = useRef<HTMLSpanElement>(null);
  const textNodeRef = useRef<Text | null>(null);
  const bufferRef = useRef<ReturnType<typeof createStreamingTextBuffer> | null>(null);
  const showingStatusRef = useRef(false);
  const onGrowthRef = useRef(onGrowth);

  useEffect(() => {
    onGrowthRef.current = onGrowth;
  }, [onGrowth]);

  useEffect(() => {
    const textContainer = textContainerRef.current;
    if (!textContainer) return;
    const textNode = document.createTextNode("");
    textContainer.replaceChildren(textNode);
    textNodeRef.current = textNode;
    bufferRef.current = createStreamingTextBuffer({
      appendText: (text) => {
        textNode.appendData(text);
        onGrowthRef.current();
      },
      replaceText: (text) => {
        textNode.data = text;
        onGrowthRef.current();
      },
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frame) => window.cancelAnimationFrame(frame),
    });
    return () => {
      bufferRef.current?.cancel();
      bufferRef.current = null;
      textNodeRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    append: (text) => {
      if (showingStatusRef.current) {
        showingStatusRef.current = false;
        bufferRef.current?.replace(text);
        return;
      }
      bufferRef.current?.append(text);
    },
    replace: (text) => {
      showingStatusRef.current = false;
      bufferRef.current?.replace(text);
    },
    setStatus: (text) => {
      showingStatusRef.current = true;
      bufferRef.current?.replace(text);
    },
    flush: () => bufferRef.current?.flush(),
    cancel: () => bufferRef.current?.cancel(),
  }), []);

  return (
    <div className="fred-streaming-preview">
      <span className="message-body fred-streaming-preview-text" ref={textContainerRef} />
      <div
        className="fred-thinking-indicator"
        role="status"
        aria-label={`${agentName} denkt nach`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fred-sniff.gif" alt="" />
      </div>
    </div>
  );
});

export default function FredNativeChatView({
  accessToken,
  conversationId,
  initialMessages,
  externalError = "",
  readOnly = false,
  readOnlyNotice,
  telegramBotUrl,
  renderAssistantContent,
  renderUserContent,
  onConversationUpdated,
}: FredNativeChatViewProps) {
  const [messages, setMessages] = useState<FredNativeMessage[]>(initialMessages);
  const [activeAssistant, setActiveAssistant] = useState<FredNativeMessage | null>(null);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [modeNotice, setModeNotice] = useState("");
  const [capabilities, setCapabilities] = useState<FredCapabilities>({
    webSearch: false,
    fileUpload: false,
    proMode: false,
  });
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [proModeEnabled, setProModeEnabled] = useState(false);
  const [conversationAgentKey, setConversationAgentKey] = useState<FredAgentKey | null>(
    conversationId ? initialMessages[0]?.agentKey ?? "fred" : null,
  );
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [pdfDownloadKey, setPdfDownloadKey] = useState("");
  const [shareInFlightIds, setShareInFlightIds] = useState<Set<number>>(() => new Set());
  const [shareCopiedKey, setShareCopiedKey] = useState("");
  const [reasoningContextMenu, setReasoningContextMenu] =
    useState<ReasoningContextMenu | null>(null);
  const [reasoningSaveDraft, setReasoningSaveDraft] =
    useState<ReasoningSaveDraft | null>(null);
  const [reasoningCategories, setReasoningCategories] =
    useState<ReasoningCategoryOption[]>([]);
  const [reasoningDialogError, setReasoningDialogError] = useState("");
  const [isReasoningCategoriesLoading, setIsReasoningCategoriesLoading] = useState(false);
  const [isSavingReasoning, setIsSavingReasoning] = useState(false);
  const [positiveFeedbackIndexes, setPositiveFeedbackIndexes] =
    useState<Set<number>>(() => new Set());
  const [submittedNegativeFeedbackIndexes, setSubmittedNegativeFeedbackIndexes] =
    useState<Set<number>>(() => new Set());
  const [feedbackTargetIndex, setFeedbackTargetIndex] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [isFeedbackSaving, setIsFeedbackSaving] = useState(false);
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());
  const activeConversationIdRef = useRef(conversationId);
  const shareStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const shareInFlightRef = useRef<Set<number>>(new Set());
  const shareAbortControllersRef = useRef<Map<number, AbortController>>(new Map());
  const streamingPreviewRef = useRef<StreamingAssistantPreviewHandle>(null);
  const followStreamGrowthRef = useRef(true);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const reasoningContextMenuRef = useRef<HTMLDivElement>(null);
  const reasoningTitleRef = useRef<HTMLInputElement>(null);
  const reasoningCategoryRequestRef = useRef(0);
  const feedbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  const feedbackRequestRef = useRef(0);
  const isReasoningDialogOpen = reasoningSaveDraft !== null;

  useEffect(() => {
    if (conversationId === activeConversationIdRef.current) return;
    if (shareStatusTimeoutRef.current) {
      clearTimeout(shareStatusTimeoutRef.current);
      shareStatusTimeoutRef.current = null;
    }
    for (const ctrl of shareAbortControllersRef.current.values()) ctrl.abort();
    shareAbortControllersRef.current.clear();
    shareInFlightRef.current.clear();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingPreviewRef.current?.cancel();
    followStreamGrowthRef.current = true;
    activeConversationIdRef.current = conversationId;
    setMessages(initialMessages);
    setActiveAssistant(null);
    setComposer("");
    setError("");
    setModeNotice("");
    const nextAgentKey = conversationId
      ? initialMessages[0]?.agentKey ?? "fred"
      : null;
    setConversationAgentKey(nextAgentKey);
    setProModeEnabled(false);
    setSelectedImages([]);
    setSelectedFiles([]);
    setIsAttachmentMenuOpen(false);
    setPdfDownloadKey("");
    setShareInFlightIds(new Set());
    setShareCopiedKey("");
    setReasoningContextMenu(null);
    setReasoningSaveDraft(null);
    setReasoningCategories([]);
    reasoningCategoryRequestRef.current += 1;
    setReasoningDialogError("");
    setIsReasoningCategoriesLoading(false);
    setIsSavingReasoning(false);
    setPositiveFeedbackIndexes(new Set());
    setSubmittedNegativeFeedbackIndexes(new Set());
    feedbackRequestRef.current += 1;
    setFeedbackTargetIndex(null);
    setFeedbackText("");
    setFeedbackError("");
    setIsFeedbackSaving(false);
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
    if (!reasoningContextMenu) return;
    const closeMenu = () => setReasoningContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (!reasoningContextMenuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [reasoningContextMenu]);

  useEffect(() => {
    if (!isReasoningDialogOpen) return;
    const focusFrame = window.requestAnimationFrame(() => reasoningTitleRef.current?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isSavingReasoning) {
        reasoningCategoryRequestRef.current += 1;
        setReasoningSaveDraft(null);
        setReasoningDialogError("");
        setIsReasoningCategoriesLoading(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isReasoningDialogOpen, isSavingReasoning]);

  useEffect(() => {
    if (feedbackTargetIndex === null) return;
    const focusFrame = window.requestAnimationFrame(() => feedbackTextareaRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [feedbackTargetIndex]);

  useEffect(() => {
    if (!modeNotice) return;
    const timer = window.setTimeout(() => setModeNotice(""), 1_800);
    return () => window.clearTimeout(timer);
  }, [modeNotice]);

  useEffect(() => {
    if (!accessToken || readOnly) return;
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
        proMode: value.proMode === true,
      });
      if (value.webSearch !== true) setWebSearchEnabled(false);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [accessToken, readOnly]);

  useEffect(() => () => {
    streamingPreviewRef.current?.cancel();
    abortControllerRef.current?.abort();
    for (const ctrl of shareAbortControllersRef.current.values()) ctrl.abort();
    shareAbortControllersRef.current.clear();
    shareInFlightRef.current.clear();
    if (shareStatusTimeoutRef.current) clearTimeout(shareStatusTimeoutRef.current);
  }, []);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    autosizeComposer(textarea);
  }, [composer]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || !followStreamGrowthRef.current) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  function scrollWithStreamGrowth(): void {
    const transcript = transcriptRef.current;
    if (!transcript || !followStreamGrowthRef.current) return;
    transcript.scrollTop = transcript.scrollHeight;
  }

  function trackTranscriptPosition(): void {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    followStreamGrowthRef.current = (
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight
    ) <= 96;
  }

  async function submitQuery(options: {
    query: string;
    webSearchEnabled?: boolean;
    proModeEnabled?: boolean;
    images: File[];
    files: File[];
    clearDraft: boolean;
    messagesBeforeQuery?: FredNativeMessage[];
    rollbackMessages?: FredNativeMessage[];
  }) {
    const query = options.query.trim();
    if (readOnly || !query || isSending || !accessToken || abortControllerRef.current) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const agentKey: FredAgentKey = conversationAgentKey ?? "fred";
    const agentName = fredAgentName(agentKey);
    const userMessage: FredNativeMessage = {
      role: "user",
      content: query,
      createdAt: new Date().toISOString(),
      agentKey,
    };
    const assistantMessage: FredNativeMessage = {
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      agentKey,
    };
    const attachedImages = options.images;
    const attachedFiles = options.files;
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
    userMessage.webSearchEnabled = options.webSearchEnabled;
    const isProMode = options.proModeEnabled === true;
    userMessage.proModeEnabled = isProMode;
    const baseMessages = [...(options.messagesBeforeQuery ?? messages), userMessage];
    setMessages(baseMessages);
    setActiveAssistant(assistantMessage);
    if (options.clearDraft) {
      setComposer("");
      resetComposerHeight(composerRef.current);
      setSelectedImages([]);
      setSelectedFiles([]);
    }
    setError("");
    setIsSending(true);

    let answerChunks: string[] = [];
    let hasAnswerContent = false;
    let researchTrace: FredResearchStep[] = [];
    let sourceReferences: FredSourceReference[] = [];
    let receivedFinal = false;
    try {
      const requestPayload = {
        query,
        conversationId: activeConversationIdRef.current || undefined,
        webSearchEnabled: options.webSearchEnabled,
        proModeEnabled: isProMode,
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
        throw new Error(responseError(
          payload,
          `${agentName} konnte die Anfrage nicht verarbeiten.`,
        ));
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(`Der ${agentName}-Antwortstream konnte nicht gelesen werden.`);
      }
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        const streamEvent = parseFredNativeStreamLine(line);
        if (!streamEvent) return;
        if (streamEvent.type === "error") throw new Error(streamEvent.error);
        if (streamEvent.type === "conversation") {
          activeConversationIdRef.current = streamEvent.conversation.id;
          setConversationAgentKey(streamEvent.conversation.agentKey);
          if (streamEvent.conversation.agentKey === "quickfred") {
            setProModeEnabled(false);
          }
          if (!options.rollbackMessages) {
            onConversationUpdated(streamEvent.conversation, baseMessages);
          }
          return;
        }
        if (streamEvent.type === "delta") {
          if (answerChunks.length === 0) streamingPreviewRef.current?.replace("");
          streamingPreviewRef.current?.append(streamEvent.content);
          answerChunks.push(streamEvent.content);
          hasAnswerContent ||= streamEvent.content.trim() !== "";
          return;
        }
        if (streamEvent.type === "replace") {
          answerChunks = [streamEvent.answer];
          hasAnswerContent = streamEvent.answer.trim() !== "";
          streamingPreviewRef.current?.replace(streamEvent.answer);
          return;
        }
        if (streamEvent.type === "status") {
          streamingPreviewRef.current?.setStatus(streamEvent.label);
          return;
        }
        if (streamEvent.type === "research") {
          researchTrace = mergeFredResearchStep(researchTrace, streamEvent.step);
          setActiveAssistant((current) => current ? {
            ...current,
            researchTrace,
            sourceReferences,
          } : current);
          return;
        }
        answerChunks = [streamEvent.answer];
        hasAnswerContent = streamEvent.answer.trim() !== "";
        researchTrace = streamEvent.researchTrace ?? researchTrace;
        sourceReferences = streamEvent.sourceReferences ?? sourceReferences;
        receivedFinal = true;
        activeConversationIdRef.current = streamEvent.conversation.id;
        setConversationAgentKey(streamEvent.conversation.agentKey);
        const completedMessage: FredNativeMessage = {
          ...assistantMessage,
          content: streamEvent.answer,
          researchTrace,
          sourceReferences,
        };
        if (streamEvent.assistantMessageId !== undefined) {
          completedMessage.id = streamEvent.assistantMessageId;
        }
        const completedMessages = [
          ...baseMessages,
          completedMessage,
        ];
        streamingPreviewRef.current?.flush();
        setActiveAssistant(null);
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
      if (!hasAnswerContent) throw new Error(`${agentName} hat keine Antwort geliefert.`);
      if (!receivedFinal) {
        throw new Error(`Der ${agentName}-Antwortstream wurde ohne Abschluss beendet.`);
      }
    } catch (sendError) {
      if (!controller.signal.aborted) {
        setError(sendError instanceof Error
          ? sendError.message
          : `${agentName} konnte die Anfrage nicht abschließen.`);
      }
      if (options.rollbackMessages) {
        setMessages(options.rollbackMessages);
      } else if (hasAnswerContent) {
        const partialAnswer = answerChunks.join("");
        setMessages([
          ...baseMessages,
          {
            ...assistantMessage,
            content: partialAnswer,
            researchTrace,
            sourceReferences,
          },
        ]);
      }
      streamingPreviewRef.current?.flush();
      setActiveAssistant(null);
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsSending(false);
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (readOnly) return;
    await submitQuery({
      query: composer,
      webSearchEnabled,
      proModeEnabled,
      images: selectedImages,
      files: selectedFiles,
      clearDraft: true,
    });
  }

  function editQuestion(message: FredNativeMessage): void {
    if (readOnly || isSending) return;
    setComposer(message.content);
    setWebSearchEnabled(Boolean(message.webSearchEnabled && capabilities.webSearch));
    setProModeEnabled(Boolean(message.proModeEnabled && capabilities.proMode));
    setSelectedImages([]);
    setSelectedFiles([]);
    setError("");
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      if (composerRef.current) autosizeComposer(composerRef.current);
    });
  }

  async function handleShareAnswer(messageId: number): Promise<void> {
    if (shareInFlightRef.current.has(messageId) || shareInFlightIds.has(messageId) || !accessToken) return;
    const conversationIdValue = activeConversationIdRef.current;
    if (!conversationIdValue) return;
    shareInFlightRef.current.add(messageId);
    setShareInFlightIds((prev) => new Set(prev).add(messageId));
    const controller = new AbortController();
    shareAbortControllersRef.current.set(messageId, controller);
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && shareAbortControllersRef.current.get(messageId) === controller
    );
    try {
      const response = await fetch("/api/fred/public-shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          conversationId: conversationIdValue,
          assistantMessageId: messageId,
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!isCurrentRequest()) return;
      if (!response.ok || typeof payload.sharePath !== "string") {
        setShareCopiedKey(`error-${messageId}`);
        return;
      }
      const url = new URL(payload.sharePath as string, window.location.origin);
      if (navigator.share) {
        try {
          await navigator.share({ title: "Geteilte Fred-Antwort", url: url.toString() });
        } catch (err: unknown) {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          if (!isCurrentRequest()) return;
          await copyToClipboard(url.toString());
          if (isCurrentRequest()) setShareCopiedKey(`copied-${messageId}`);
        }
      } else {
        await copyToClipboard(url.toString());
        if (isCurrentRequest()) setShareCopiedKey(`copied-${messageId}`);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      if (isCurrentRequest()) setShareCopiedKey(`error-${messageId}`);
    } finally {
      if (shareAbortControllersRef.current.get(messageId) === controller) {
        shareAbortControllersRef.current.delete(messageId);
        shareInFlightRef.current.delete(messageId);
        setShareInFlightIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        if (shareStatusTimeoutRef.current) clearTimeout(shareStatusTimeoutRef.current);
        shareStatusTimeoutRef.current = setTimeout(() => {
          setShareCopiedKey("");
          shareStatusTimeoutRef.current = null;
        }, 3_000);
      }
    }
  }

  function regenerateAnswer(assistantIndex: number): void {
    if (readOnly) return;
    const question = precedingUserMessage(messages, assistantIndex);
    const messagesBeforeQuery = messagesBeforeRegeneratedAnswer(messages, assistantIndex);
    if (!question || !messagesBeforeQuery || isSending) return;
    const originalProMode = Boolean(question.proModeEnabled && capabilities.proMode);
    setProModeEnabled(originalProMode);
    void submitQuery({
      query: question.content,
      webSearchEnabled: Boolean(question.webSearchEnabled && capabilities.webSearch),
      proModeEnabled: originalProMode,
      images: [],
      files: [],
      clearDraft: false,
      messagesBeforeQuery,
      rollbackMessages: messages,
    });
  }

  async function downloadFredPdf(title: string, content: string, key: string): Promise<void> {
    if (!accessToken || pdfDownloadKey || !content.trim()) return;
    setError("");
    setPdfDownloadKey(key);
    try {
      await downloadFredPdfFile({ accessToken, title, content });
    } catch (downloadError) {
      setError(downloadError instanceof Error
        ? downloadError.message
        : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setPdfDownloadKey("");
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

  function handleAssistantContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (
      !selection
      || selection.isCollapsed
      || !selection.anchorNode
      || !selection.focusNode
      || !event.currentTarget.contains(selection.anchorNode)
      || !event.currentTarget.contains(selection.focusNode)
    ) {
      setReasoningContextMenu(null);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setReasoningContextMenu(null);
      return;
    }

    event.preventDefault();
    if (selectedText.length > MAX_REASONING_CONTENT_CHARS) {
      setReasoningContextMenu(null);
      setModeNotice(
        `Die Auswahl darf maximal ${MAX_REASONING_CONTENT_CHARS.toLocaleString("de-AT")} Zeichen enthalten.`,
      );
      return;
    }

    const edge = 10;
    const menuWidth = 240;
    const menuHeight = 92;
    setReasoningContextMenu({
      text: selectedText,
      left: Math.max(edge, Math.min(event.clientX, window.innerWidth - menuWidth - edge)),
      top: Math.max(edge, Math.min(event.clientY, window.innerHeight - menuHeight - edge)),
    });
  }

  async function copyReasoningContextText(): Promise<void> {
    if (!reasoningContextMenu) return;
    try {
      await copyToClipboard(reasoningContextMenu.text);
      setReasoningContextMenu(null);
      setModeNotice("Auswahl kopiert");
    } catch {
      setModeNotice("Kopieren fehlgeschlagen");
    }
  }

  function togglePositiveFeedback(index: number): void {
    if (submittedNegativeFeedbackIndexes.has(index)) return;
    setPositiveFeedbackIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    if (feedbackTargetIndex === index) {
      setFeedbackTargetIndex(null);
      setFeedbackText("");
      setFeedbackError("");
    }
  }

  function openNegativeFeedback(index: number): void {
    if (submittedNegativeFeedbackIndexes.has(index)) return;
    setPositiveFeedbackIndexes((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
    setFeedbackTargetIndex(index);
    setFeedbackText("");
    setFeedbackError("");
  }

  function closeNegativeFeedback(): void {
    if (isFeedbackSaving) return;
    setFeedbackTargetIndex(null);
    setFeedbackText("");
    setFeedbackError("");
  }

  async function submitNegativeFeedback(
    event: FormEvent<HTMLFormElement>,
    messageIndex: number,
  ): Promise<void> {
    event.preventDefault();
    if (isFeedbackSaving) return;
    const message = messages[messageIndex];
    const userRequest = findNearestPrecedingUserMessage(messages, messageIndex);
    const feedback = feedbackText.trim();
    const currentConversationId = activeConversationIdRef.current;
    if (
      !message
      || message.role !== "assistant"
      || !message.content.trim()
      || !userRequest
      || !currentConversationId
    ) {
      setFeedbackError("Die zugehörige Fred-Antwort konnte nicht zugeordnet werden.");
      return;
    }
    if (!feedback) {
      setFeedbackError("Bitte beschreibe, warum die Antwort nicht korrekt ist.");
      return;
    }
    if (feedback.length > MAX_AGENT_FEEDBACK_CHARS) {
      setFeedbackError(
        `Die Rückmeldung darf maximal ${MAX_AGENT_FEEDBACK_CHARS.toLocaleString("de-AT")} Zeichen enthalten.`,
      );
      return;
    }
    if (!accessToken) {
      setFeedbackError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setIsFeedbackSaving(true);
    setFeedbackError("");
    const requestId = feedbackRequestRef.current + 1;
    feedbackRequestRef.current = requestId;
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: currentConversationId,
          userRequest,
          assistantResponse: message.content,
          feedback,
        }),
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        throw new Error(responseError(payload, "Rückmeldung konnte nicht gespeichert werden."));
      }
      if (feedbackRequestRef.current !== requestId) return;
      setSubmittedNegativeFeedbackIndexes((current) => new Set(current).add(messageIndex));
      setFeedbackTargetIndex(null);
      setFeedbackText("");
      setModeNotice("Danke für deine Rückmeldung.");
    } catch (feedbackSaveError) {
      if (feedbackRequestRef.current !== requestId) return;
      setFeedbackError(
        feedbackSaveError instanceof Error
          ? feedbackSaveError.message
          : "Rückmeldung konnte nicht gespeichert werden.",
      );
    } finally {
      if (feedbackRequestRef.current === requestId) setIsFeedbackSaving(false);
    }
  }

  async function loadReasoningCategories(): Promise<void> {
    if (!accessToken) {
      setReasoningDialogError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }
    const requestId = reasoningCategoryRequestRef.current + 1;
    reasoningCategoryRequestRef.current = requestId;
    setIsReasoningCategoriesLoading(true);
    try {
      const response = await fetch("/api/reasoning-categories", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        throw new Error(responseError(payload, "Kategorien konnten nicht geladen werden."));
      }
      if (reasoningCategoryRequestRef.current !== requestId) return;
      const categories = categoryOptions(payload);
      setReasoningCategories(categories);
      setReasoningSaveDraft((current) => {
        if (!current || current.categoryMode === "new") return current;
        return {
          ...current,
          categoryMode: categories.length > 0 ? "existing" : "new",
          categoryId: categories[0]?.id ?? "",
        };
      });
    } catch (categoryError) {
      if (reasoningCategoryRequestRef.current !== requestId) return;
      setReasoningCategories([]);
      setReasoningSaveDraft((current) => current ? {
        ...current,
        categoryMode: "new",
        categoryId: "",
      } : current);
      setReasoningDialogError(
        categoryError instanceof Error
          ? categoryError.message
          : "Kategorien konnten nicht geladen werden.",
      );
    } finally {
      if (reasoningCategoryRequestRef.current === requestId) {
        setIsReasoningCategoriesLoading(false);
      }
    }
  }

  function openReasoningSaveDialog(): void {
    if (!reasoningContextMenu) return;
    const text = reasoningContextMenu.text;
    setReasoningContextMenu(null);
    setReasoningCategories([]);
    setReasoningDialogError("");
    setReasoningSaveDraft({
      text,
      title: "",
      categoryMode: "existing",
      categoryId: "",
      newCategoryName: "",
    });
    void loadReasoningCategories();
  }

  function closeReasoningSaveDialog(): void {
    if (isSavingReasoning) return;
    reasoningCategoryRequestRef.current += 1;
    setReasoningSaveDraft(null);
    setReasoningDialogError("");
    setIsReasoningCategoriesLoading(false);
  }

  async function saveSelectedReasoning(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!reasoningSaveDraft || isSavingReasoning) return;

    const title = reasoningSaveDraft.title.trim();
    if (!title) {
      setReasoningDialogError("Bitte einen Titel eingeben.");
      return;
    }
    if (title.length > MAX_REASONING_TITLE_CHARS) {
      setReasoningDialogError(
        `Der Titel darf maximal ${MAX_REASONING_TITLE_CHARS} Zeichen lang sein.`,
      );
      return;
    }
    if (!reasoningSaveDraft.text || reasoningSaveDraft.text.length > MAX_REASONING_CONTENT_CHARS) {
      setReasoningDialogError("Der ausgewählte Textbaustein ist ungültig.");
      return;
    }
    if (!accessToken) {
      setReasoningDialogError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setIsSavingReasoning(true);
    setReasoningDialogError("");
    try {
      let categoryId = reasoningSaveDraft.categoryId;
      if (reasoningSaveDraft.categoryMode === "new") {
        const categoryName = reasoningSaveDraft.newCategoryName.trim();
        if (!categoryName) {
          throw new Error("Bitte einen Namen für die neue Kategorie eingeben.");
        }
        if (categoryName.length > MAX_REASONING_CATEGORY_NAME_CHARS) {
          throw new Error(
            `Der Kategoriename darf maximal ${MAX_REASONING_CATEGORY_NAME_CHARS} Zeichen lang sein.`,
          );
        }
        const categoryResponse = await fetch("/api/reasoning-categories", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: categoryName }),
        });
        const categoryPayload = await categoryResponse.json().catch(() => null) as unknown;
        if (!categoryResponse.ok) {
          throw new Error(responseError(
            categoryPayload,
            "Kategorie konnte nicht angelegt werden.",
          ));
        }
        const createdCategory = categoryOption(
          categoryPayload && typeof categoryPayload === "object" && !Array.isArray(categoryPayload)
            ? (categoryPayload as Record<string, unknown>).category
            : null,
        );
        if (!createdCategory) {
          throw new Error("Die angelegte Kategorie konnte nicht gelesen werden.");
        }
        categoryId = createdCategory.id;
        setReasoningCategories((current) => orderReasoningCategories([
          ...current.filter((category) => category.id !== createdCategory.id),
          createdCategory,
        ]));
        setReasoningSaveDraft((current) => current ? {
          ...current,
          categoryMode: "existing",
          categoryId: createdCategory.id,
          newCategoryName: "",
        } : current);
      } else if (!categoryId) {
        throw new Error("Bitte eine Kategorie auswählen.");
      }

      const reasoningResponse = await fetch("/api/reasonings", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          content: reasoningSaveDraft.text,
          categoryIds: [categoryId],
        }),
      });
      const reasoningPayload = await reasoningResponse.json().catch(() => null) as unknown;
      if (!reasoningResponse.ok) {
        throw new Error(responseError(
          reasoningPayload,
          "Textbaustein konnte nicht gespeichert werden.",
        ));
      }

      setReasoningSaveDraft(null);
      setReasoningDialogError("");
      window.getSelection()?.removeAllRanges();
      setModeNotice("Als Textbaustein gespeichert");
    } catch (saveError) {
      setReasoningDialogError(
        saveError instanceof Error
          ? saveError.message
          : "Textbaustein konnte nicht gespeichert werden.",
      );
    } finally {
      setIsSavingReasoning(false);
    }
  }

  return (
    <section className={`chat-panel ${messages.length === 0 ? "empty-chat" : ""}`} aria-label="Fred">
      <div className="chat-content-group">
        {readOnly && readOnlyNotice ? (
          <div className="fred-readonly-notice" role="status">
            <span>{readOnlyNotice}</span>
            {telegramBotUrl ? (
              <a
                className="secondary-button compact-button"
                href={telegramBotUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                In Telegram öffnen
              </a>
            ) : null}
          </div>
        ) : null}
        <div
          className="transcript"
          ref={transcriptRef}
          aria-live="polite"
          onScroll={trackTranscriptPosition}
        >
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
                    <span className="sender-name">
                      {message.role === "user" ? "Du" : fredAgentName(message.agentKey)}
                    </span>
                    <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                  </div>
                  <div className="message-actions">
                    {!readOnly && message.role === "user" && message.content ? (
                      <button
                        className="message-action-button"
                        type="button"
                        aria-label="Frage bearbeiten"
                        title="Frage bearbeiten"
                        disabled={isSending}
                        onClick={() => editQuestion(message)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m4 20 4.4-1 9.8-9.8-3.4-3.4L5 15.6 4 20Z" />
                          <path d="m13.8 6.8 3.4 3.4M14.8 5.8l1.4-1.4a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8l-1.4 1.4" />
                        </svg>
                      </button>
                    ) : null}
                    {message.role === "assistant"
                      && message.content
                      && !(isSending && index === messages.length - 1) ? (
                        <>
                          <CopyIconButton
                            text={message.content}
                            label="Antwort kopieren"
                          />
                          <button
                            className="message-action-button"
                            type="button"
                            aria-label="Antwort als PDF exportieren"
                            title={pdfDownloadKey === `answer-${index}`
                              ? "PDF wird erstellt …"
                              : "Antwort als PDF exportieren"}
                            aria-busy={pdfDownloadKey === `answer-${index}`}
                            disabled={Boolean(pdfDownloadKey)}
                            onClick={() => void downloadFredPdf(
                              `${fredAgentName(message.agentKey)}-Antwort`,
                              message.content,
                              `answer-${index}`,
                            )}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v2h14v-2" />
                            </svg>
                          </button>
                          <button
                            className="message-action-button"
                            type="button"
                            aria-label="Antwort öffentlich teilen"
                            title={
                              shareInFlightIds.has(message.id!)
                                ? "Wird geteilt …"
                                : shareCopiedKey === `copied-${message.id}`
                                  ? "Öffentlicher Link kopiert"
                                  : shareCopiedKey === `error-${message.id}`
                                    ? "Teilen fehlgeschlagen"
                                    : "Antwort öffentlich teilen"
                            }
                            aria-busy={shareInFlightIds.has(message.id!)}
                            disabled={shareInFlightIds.has(message.id!) || !message.id}
                            onClick={() => void handleShareAnswer(message.id!)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <circle cx="18" cy="5" r="3" />
                              <circle cx="6" cy="12" r="3" />
                              <circle cx="18" cy="19" r="3" />
                              <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
                            </svg>
                          </button>
                          {(shareInFlightIds.has(message.id!)
                            || shareCopiedKey === `copied-${message.id}`
                            || shareCopiedKey === `error-${message.id}`) ? (
                            <span
                              className="fred-share-status"
                              role="status"
                              aria-live="polite"
                            >
                              {shareInFlightIds.has(message.id!)
                                ? "Wird geteilt …"
                                : shareCopiedKey === `copied-${message.id}`
                                  ? "Öffentlicher Link kopiert"
                                  : "Teilen fehlgeschlagen"}
                            </span>
                          ) : null}
                          {!readOnly && index === messages.length - 1 ? (
                            <button
                              className="message-action-button"
                              type="button"
                              aria-label="Antwort erneut erzeugen"
                              title="Antwort erneut erzeugen"
                              disabled={isSending}
                              onClick={() => regenerateAnswer(index)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                                <path d="M20 4v7h-7" />
                              </svg>
                            </button>
                          ) : null}
                        </>
                      ) : null}
                  </div>
                </div>
                {message.role === "assistant"
                  ? (message.content
                    ? (
                      <div
                        className="fred-assistant-answer"
                        onContextMenu={handleAssistantContextMenu}
                      >
                        {renderAssistantContent(message.content)}
                      </div>
                    )
                    : (
                      <div
                        className="fred-thinking-indicator"
                        role="status"
                        aria-label={`${fredAgentName(message.agentKey)} denkt nach`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/fred-sniff.gif" alt="" />
                      </div>
                    ))
                  : renderUserContent(message.content)}
                {message.role === "assistant" && message.content ? (
                  <ResearchTrace
                    steps={message.researchTrace ?? []}
                    sources={message.sourceReferences ?? []}
                    active={false}
                    agentName={fredAgentName(message.agentKey)}
                  />
                ) : null}
                {message.role === "assistant"
                  && message.content
                  && !(isSending && index === messages.length - 1) ? (
                    <div className="fred-feedback">
                      <div
                        className="feedback-controls"
                        aria-label="Fred-Antwort bewerten"
                      >
                        <button
                          className={`feedback-button feedback-positive ${
                            positiveFeedbackIndexes.has(index) ? "is-active" : ""
                          }`}
                          type="button"
                          aria-label="Antwort hilfreich"
                          title="Antwort hilfreich"
                          aria-pressed={positiveFeedbackIndexes.has(index)}
                          disabled={submittedNegativeFeedbackIndexes.has(index)}
                          onClick={() => togglePositiveFeedback(index)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 10v10H4V10h3Zm3 10V9l4-6 1.5.8-.8 5.2H20v2.5L18.5 20H10Z" />
                          </svg>
                        </button>
                        <button
                          className={`feedback-button feedback-negative ${
                            feedbackTargetIndex === index
                            || submittedNegativeFeedbackIndexes.has(index)
                              ? "is-active"
                              : ""
                          }`}
                          type="button"
                          aria-label="Antwort nicht korrekt"
                          title="Antwort nicht korrekt"
                          aria-pressed={
                            feedbackTargetIndex === index
                            || submittedNegativeFeedbackIndexes.has(index)
                          }
                          disabled={submittedNegativeFeedbackIndexes.has(index)}
                          onClick={() => openNegativeFeedback(index)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 14V4H4v10h3Zm3-10v11l4 6 1.5-.8-.8-5.2H20v-2.5L18.5 4H10Z" />
                          </svg>
                        </button>
                      </div>

                      {feedbackTargetIndex === index ? (
                        <form
                          className="feedback-inline-form"
                          onSubmit={(event) => void submitNegativeFeedback(event, index)}
                        >
                          <label htmlFor={`fred-feedback-${index}`}>
                            Warum ist diese Antwort nicht korrekt?
                          </label>
                          <textarea
                            ref={feedbackTextareaRef}
                            id={`fred-feedback-${index}`}
                            value={feedbackText}
                            onChange={(event) => {
                              setFeedbackText(event.target.value);
                              setFeedbackError("");
                            }}
                            maxLength={MAX_AGENT_FEEDBACK_CHARS}
                            placeholder="Bitte beschreibe kurz den Fehler oder was verbessert werden sollte."
                            disabled={isFeedbackSaving}
                            required
                          />
                          {feedbackError ? (
                            <div className="error-box" role="alert" aria-live="polite">
                              {feedbackError}
                            </div>
                          ) : null}
                          <div className="feedback-inline-actions">
                            <button
                              className="secondary-button compact-button"
                              type="button"
                              onClick={closeNegativeFeedback}
                              disabled={isFeedbackSaving}
                            >
                              Abbrechen
                            </button>
                            <button
                              className="primary-button compact-button"
                              type="submit"
                              disabled={isFeedbackSaving || !feedbackText.trim()}
                            >
                              {isFeedbackSaving ? "Wird gespeichert …" : "Rückmeldung senden"}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                {message.role === "user" && (
                  message.agentKey === "quickfred"
                  || message.attachments?.length
                  || message.webSearchEnabled
                  || message.proModeEnabled
                ) ? (
                  <div className="fred-native-message-options">
                    {message.agentKey === "quickfred" ? (
                      <span className="fred-native-option-badge">QuickFred</span>
                    ) : null}
                    {message.proModeEnabled ? (
                      <span className="fred-native-option-badge">Pro</span>
                    ) : null}
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
            {activeAssistant ? (
              <article className="message assistant pending">
                <div className="message-header">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="message-avatar fred-avatar" src="/fred-avatar.png" alt="" />
                  <div className="message-meta">
                    <span className="sender-name">{fredAgentName(activeAssistant.agentKey)}</span>
                    <time dateTime={activeAssistant.createdAt}>{formatTime(activeAssistant.createdAt)}</time>
                  </div>
                </div>
                <StreamingAssistantPreview
                  ref={streamingPreviewRef}
                  agentName={fredAgentName(activeAssistant.agentKey)}
                  onGrowth={scrollWithStreamGrowth}
                />
                <ResearchTrace
                  steps={activeAssistant.researchTrace ?? []}
                  sources={activeAssistant.sourceReferences ?? []}
                  active
                  agentName={fredAgentName(activeAssistant.agentKey)}
                />
              </article>
            ) : null}
          </div>
        </div>

        {readOnly ? null : (
        <div className="composer-container">
          {modeNotice ? (
            <div className="fred-mode-notice" role="status" aria-live="polite" aria-atomic="true" key={modeNotice}>
              {modeNotice}
            </div>
          ) : null}
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
                {capabilities.proMode ? (
                  <button
                    className={`composer-model-trigger composer-icon-toggle fred-pro-toggle${proModeEnabled ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={proModeEnabled}
                    title="Thinking"
                    aria-label={proModeEnabled ? "Pro-Modus aktiv" : "Pro-Modus verwenden"}
                    disabled={isSending || conversationAgentKey === "quickfred"}
                    onClick={() => {
                      const nextEnabled = !proModeEnabled;
                      setProModeEnabled(nextEnabled);
                      setModeNotice(nextEnabled ? "Thinking aktiviert" : "Thinking deaktiviert");
                    }}
                  >
                    <svg className="fred-pro-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9.5 4.5A2.5 2.5 0 0 0 7 7v.5a3.5 3.5 0 0 0-1 6.85V15a3 3 0 0 0 6 0V7a2.5 2.5 0 0 0-2.5-2.5Z" />
                      <path d="M14.5 4.5A2.5 2.5 0 0 1 17 7v.5a3.5 3.5 0 0 1 1 6.85V15a3 3 0 0 1-6 0V7a2.5 2.5 0 0 1 2.5-2.5Z" />
                      <path d="M8 10h1a3 3 0 0 1 3 3M16 10h-1a3 3 0 0 0-3 3M9 14a3 3 0 0 0 3 3M15 14a3 3 0 0 1-3 3" />
                    </svg>
                  </button>
                ) : null}
                {capabilities.webSearch ? (
                  <button
                    className={`composer-model-trigger composer-icon-toggle fred-web-search-toggle${webSearchEnabled ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={webSearchEnabled}
                    title="Websuche"
                    aria-label={webSearchEnabled ? "Websuche aktiv" : "Websuche verwenden"}
                    onClick={() => {
                      const nextEnabled = !webSearchEnabled;
                      setWebSearchEnabled(nextEnabled);
                      setModeNotice(nextEnabled ? "Websuche aktiviert" : "Websuche deaktiviert");
                    }}
                    disabled={isSending}
                  >
                    <svg className="fred-web-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3c2.3 2.45 3.5 5.45 3.5 9s-1.2 6.55-3.5 9M12 3c-2.3 2.45-3.5 5.45-3.5 9s1.2 6.55 3.5 9" />
                    </svg>
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
        )}
      </div>

      {reasoningContextMenu ? (
        <div
          ref={reasoningContextMenuRef}
          className="fred-reasoning-context-menu"
          role="menu"
          aria-label="Aktionen für markierten Antworttext"
          style={{ left: reasoningContextMenu.left, top: reasoningContextMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyReasoningContextText()}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="8" y="8" width="11" height="11" rx="2" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </svg>
            Kopieren
          </button>
          <button
            className="is-primary"
            type="button"
            role="menuitem"
            onClick={openReasoningSaveDialog}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" />
              <path d="M12 7v6M9 10h6" />
            </svg>
            Als Textbaustein speichern
          </button>
        </div>
      ) : null}

      {reasoningSaveDraft ? (
        <div
          className="dialog-backdrop fred-reasoning-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeReasoningSaveDialog();
          }}
        >
          <section
            className="fred-reasoning-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fred-reasoning-dialog-title"
          >
            <header className="fred-reasoning-dialog-header">
              <div>
                <p className="eyebrow">Fred-Auswahl</p>
                <h2 id="fred-reasoning-dialog-title">Als Textbaustein speichern</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={closeReasoningSaveDialog}
                disabled={isSavingReasoning}
                aria-label="Dialog schließen"
                title="Schließen"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M5 5 19 19M19 5 5 19" />
                </svg>
              </button>
            </header>

            <form className="fred-reasoning-form" onSubmit={saveSelectedReasoning}>
              <div className="fred-reasoning-selection-preview">
                <span>Ausgewählter Text</span>
                <p>{reasoningSaveDraft.text}</p>
                <small>
                  {reasoningSaveDraft.text.length.toLocaleString("de-AT")} Zeichen
                </small>
              </div>

              <div className="field-group">
                <label htmlFor="fred-reasoning-title">Titel</label>
                <input
                  ref={reasoningTitleRef}
                  id="fred-reasoning-title"
                  value={reasoningSaveDraft.title}
                  onChange={(event) => {
                    setReasoningSaveDraft((current) => current ? {
                      ...current,
                      title: event.target.value,
                    } : current);
                    setReasoningDialogError("");
                  }}
                  maxLength={MAX_REASONING_TITLE_CHARS}
                  placeholder="Kurzer, eindeutiger Titel"
                  disabled={isSavingReasoning}
                  required
                />
              </div>

              <fieldset className="fred-reasoning-category-choice">
                <legend>Kategorie</legend>
                <label className="fred-reasoning-category-mode">
                  <input
                    type="radio"
                    name="fred-reasoning-category-mode"
                    value="existing"
                    checked={reasoningSaveDraft.categoryMode === "existing"}
                    onChange={() => {
                      setReasoningSaveDraft((current) => current ? {
                        ...current,
                        categoryMode: "existing",
                        categoryId: current.categoryId || reasoningCategories[0]?.id || "",
                      } : current);
                      setReasoningDialogError("");
                    }}
                    disabled={
                      isSavingReasoning
                      || isReasoningCategoriesLoading
                      || reasoningCategories.length === 0
                    }
                  />
                  <span>Vorhandene Kategorie</span>
                </label>
                {isReasoningCategoriesLoading ? (
                  <p className="fred-reasoning-category-status" role="status">
                    Kategorien werden geladen …
                  </p>
                ) : reasoningCategories.length > 0 ? (
                  <select
                    aria-label="Vorhandene Kategorie"
                    value={reasoningSaveDraft.categoryId}
                    onChange={(event) => {
                      setReasoningSaveDraft((current) => current ? {
                        ...current,
                        categoryId: event.target.value,
                      } : current);
                      setReasoningDialogError("");
                    }}
                    disabled={
                      isSavingReasoning
                      || reasoningSaveDraft.categoryMode !== "existing"
                    }
                  >
                    {reasoningCategories.map((category) => (
                      <option value={category.id} key={category.id}>
                        {reasoningCategoryLabel(category, reasoningCategories)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="fred-reasoning-category-status">
                    Noch keine Kategorie vorhanden.
                  </p>
                )}

                <label className="fred-reasoning-category-mode">
                  <input
                    type="radio"
                    name="fred-reasoning-category-mode"
                    value="new"
                    checked={reasoningSaveDraft.categoryMode === "new"}
                    onChange={() => {
                      setReasoningSaveDraft((current) => current ? {
                        ...current,
                        categoryMode: "new",
                      } : current);
                      setReasoningDialogError("");
                    }}
                    disabled={isSavingReasoning}
                  />
                  <span>Neue Kategorie anlegen</span>
                </label>
                {reasoningSaveDraft.categoryMode === "new" ? (
                  <input
                    aria-label="Name der neuen Kategorie"
                    value={reasoningSaveDraft.newCategoryName}
                    onChange={(event) => {
                      setReasoningSaveDraft((current) => current ? {
                        ...current,
                        newCategoryName: event.target.value,
                      } : current);
                      setReasoningDialogError("");
                    }}
                    maxLength={MAX_REASONING_CATEGORY_NAME_CHARS}
                    placeholder="z. B. Betriebsausgaben"
                    disabled={isSavingReasoning}
                    required
                  />
                ) : null}
              </fieldset>

              {reasoningDialogError ? (
                <div className="error-box" role="alert" aria-live="polite">
                  {reasoningDialogError}
                </div>
              ) : null}

              <div className="fred-reasoning-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeReasoningSaveDialog}
                  disabled={isSavingReasoning}
                >
                  Abbrechen
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    isSavingReasoning
                    || isReasoningCategoriesLoading
                    || !reasoningSaveDraft.title.trim()
                    || (
                      reasoningSaveDraft.categoryMode === "existing"
                        ? !reasoningSaveDraft.categoryId
                        : !reasoningSaveDraft.newCategoryName.trim()
                    )
                  }
                >
                  {isSavingReasoning ? "Wird gespeichert …" : "Speichern"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
