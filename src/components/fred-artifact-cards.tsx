"use client";

import { useState } from "react";
import type { FredGeneratedArtifact } from "@/lib/fred-native-stream";

function kindFor(artifact: FredGeneratedArtifact): { label: string; icon: string } {
  const extension = /\.[^.]+$/u.exec(artifact.fileName.toLowerCase())?.[0] ?? artifact.fileType;
  if (extension === ".pdf") return { label: "PDF", icon: "PDF" };
  if (extension === ".md") return { label: "Markdown", icon: "MD" };
  if (extension === ".txt") return { label: "Text", icon: "TXT" };
  return { label: "Datei", icon: "FILE" };
}

function displayFileSize(bytes: number): string {
  if (bytes < 1_024 * 1_024) return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export type FredArtifactCardsProps = {
  accessToken: string;
  artifacts: FredGeneratedArtifact[];
  conversationId: string;
  messageId?: number;
};

export default function FredArtifactCards({ accessToken, artifacts, conversationId, messageId }: FredArtifactCardsProps) {
  const [states, setStates] = useState<Record<string, "loading" | "error">>({});
  if (!messageId || artifacts.length === 0) return null;
  return <div className="fred-artifact-list" aria-label="Erzeugte Dateien">
    {artifacts.map((artifact) => {
      const kind = kindFor(artifact);
      const state = states[artifact.id];
      const href = `/api/fred/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}/artifacts/${artifact.upstreamIndex}`;
      const download = async () => {
        setStates((current) => ({ ...current, [artifact.id]: "loading" }));
        try {
          const response = await fetch(href, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!response.ok) throw new Error("Download fehlgeschlagen");
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = artifact.fileName;
          link.click();
          URL.revokeObjectURL(objectUrl);
          setStates((current) => { const next = { ...current }; delete next[artifact.id]; return next; });
        } catch {
          setStates((current) => ({ ...current, [artifact.id]: "error" }));
        }
      };
      return <button className="fred-artifact-card" type="button" onClick={() => void download()} disabled={state === "loading"} key={artifact.id} aria-label={`${artifact.fileName} herunterladen`}>
        <span className="fred-artifact-icon" aria-hidden="true">{kind.icon}</span>
        <span className="fred-artifact-copy"><strong>{artifact.fileName}</strong><small>{state === "loading" ? "Wird geladen …" : state === "error" ? "Download fehlgeschlagen · erneut versuchen" : `${kind.label} · ${displayFileSize(artifact.fileSize)}`}</small></span>
        <span className="fred-artifact-download" aria-hidden="true">{state === "loading" ? "…" : "↓"}</span>
      </button>;
    })}
  </div>;
}
