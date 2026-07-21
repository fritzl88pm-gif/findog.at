"use client";

import { useEffect, useRef, useState } from "react";

type CopyStatus = "idle" | "copied" | "error";

type CopyIconButtonProps = {
  text: string;
  html?: string;
  label: string;
  className?: string;
};

function legacyCopyText(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error("Clipboard copy failed");
}

async function copyToClipboard(text: string, html?: string): Promise<void> {
  if (html && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some browsers reject rich clipboard types but still allow plain text.
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  legacyCopyText(text);
}

export default function CopyIconButton({
  text,
  html,
  label,
  className = "",
}: CopyIconButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  async function handleCopy(): Promise<void> {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    try {
      await copyToClipboard(text, html);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    resetTimerRef.current = setTimeout(() => setStatus("idle"), 1_800);
  }

  const accessibleLabel = status === "copied"
    ? "Kopiert"
    : status === "error"
      ? "Kopieren fehlgeschlagen"
      : label;

  return (
    <button
      className={`copy-icon-button ${status === "idle" ? "" : `is-${status}`} ${className}`.trim()}
      type="button"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      disabled={!text}
      onClick={() => void handleCopy()}
    >
      {status === "copied" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12.5 4.2 4.2L19 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      )}
      <span className="sr-only" aria-live="polite">
        {status === "idle" ? "" : accessibleLabel}
      </span>
    </button>
  );
}
