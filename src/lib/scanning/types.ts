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
