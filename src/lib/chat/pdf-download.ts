import {
  MAX_FRED_PDF_EXPORT_CHARS,
  pdfFilenameFromHeader,
} from "@/lib/chat/fred-actions";

type FredPdfDownloadOptions = {
  accessToken: string;
  title: string;
  content: string;
  fallbackFilename?: string;
};

function pdfResponseError(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return "Das PDF konnte nicht erstellt werden.";
}

export async function downloadFredPdfFile({
  accessToken,
  title,
  content,
  fallbackFilename = "Fred.pdf",
}: FredPdfDownloadOptions): Promise<void> {
  if (!accessToken) {
    throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
  }
  if (!content.trim()) {
    throw new Error("Der PDF-Export enthält keinen Inhalt.");
  }
  if (content.length > MAX_FRED_PDF_EXPORT_CHARS) {
    throw new Error("Der Inhalt ist für einen einzelnen PDF-Export zu umfangreich.");
  }

  const response = await fetch("/api/tools/pdf", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, content }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as unknown;
    throw new Error(pdfResponseError(payload));
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = pdfFilenameFromHeader(
    response.headers.get("content-disposition"),
    fallbackFilename,
  );
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}
