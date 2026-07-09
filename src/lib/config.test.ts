import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYSTEM_PROMPT,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  MAX_REQUEST_BYTES,
  MAX_SYSTEM_PROMPT_CHARS,
} from "./config";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("contains the full Fred prompt and fits within the accepted request bounds", () => {
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(24_000);
    expect(MAX_SYSTEM_PROMPT_CHARS).toBeGreaterThanOrEqual(DEFAULT_SYSTEM_PROMPT.length);
    expect(MAX_REQUEST_BYTES).toBeGreaterThanOrEqual(MAX_SYSTEM_PROMPT_CHARS * 2);
  });

  it("keeps JSON requests bounded separately from PDF multipart uploads", () => {
    expect(MAX_REQUEST_BYTES).toBe(400_000);
    expect(MAX_PDF_UPLOAD_BYTES).toBe(50_000_000);
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(5_000_000);
    expect(MAX_PDF_UPLOADS).toBe(5);
    expect(MAX_IMAGE_UPLOADS).toBe(5);
    expect(MAX_MULTIPART_REQUEST_BYTES).toBeGreaterThanOrEqual(
      MAX_REQUEST_BYTES + MAX_PDF_UPLOAD_BYTES * MAX_PDF_UPLOADS + MAX_IMAGE_UPLOAD_BYTES * MAX_IMAGE_UPLOADS,
    );
  });
});
