export type ScanningFileKind = "image" | "pdf";

export type ScanningUpload = {
  id: string;
  kind: ScanningFileKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};

export type ScanningVatEntry = {
  rate: string;
  net: string | null;
  tax: string | null;
  gross: string | null;
};

export type ScanningDocument = {
  documentId: string;
  fileId: string;
  fileName: string;
  documentType: string;
  date: string | null;
  issuer: string;
  documentNumber: string;
  description: string;
  category: string;
  currency: string | null;
  net: string | null;
  tax: string | null;
  gross: string | null;
  vatBreakdown: ScanningVatEntry[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
};

export type ScanningFileStatus = {
  id: string;
  name: string;
  kind: ScanningFileKind;
  status: "completed" | "failed" | "duplicate";
  detail?: string;
};

export type ScanningProgressStage = "validating" | "extracting" | "organizing";

export type ScanningStreamEvent =
  | {
      type: "progress";
      stage: ScanningProgressStage;
      completed: number;
      total: number;
      fileName?: string;
    }
  | {
      type: "final";
      report: string;
      files: ScanningFileStatus[];
      model: "google/gemini-3.5-flash";
    }
  | { type: "error"; error: string };

export type ScanningOrganization = {
  summary: string;
  categories: Array<{ documentId: string; category: string }>;
};
