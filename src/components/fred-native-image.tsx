"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface FredNativeImageProps {
  artifactId: string;
  alt?: string;
  className?: string;
}

export function FredNativeImage({ artifactId, alt = "", className = "" }: FredNativeImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const controller = new AbortController();

    async function loadArtifact() {
      try {
        setStatus("loading");
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          if (active) setStatus("error");
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (active) setStatus("error");
          return;
        }

        const response = await fetch(`/api/fred/artifacts/${encodeURIComponent(artifactId)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          if (active) setStatus("error");
          return;
        }

        const blob = await response.blob();
        if (!active) return;

        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setStatus("loaded");
      } catch {
        if (active && !controller.signal.aborted) {
          setStatus("error");
        }
      }
    }

    void loadArtifact();

    return () => {
      active = false;
      controller.abort();
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [artifactId]);

  if (status === "loading") {
    return (
      <span className="fred-native-image-container fred-native-image-loading">
        <span className="fred-native-image-placeholder" role="status" aria-label={alt || "Bild lädt …"}>
          {alt ? `[Bild: ${alt}]` : "[Bild lädt …]"}
        </span>
      </span>
    );
  }

  if (status === "error" || !objectUrl) {
    return null;
  }

  return (
    <span className="fred-native-image-container">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={objectUrl}
        alt={alt}
        className={`fred-native-image ${className}`.trim()}
        loading="lazy"
      />
    </span>
  );
}

export default FredNativeImage;
