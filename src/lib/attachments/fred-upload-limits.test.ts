import { describe, expect, it } from "vitest";

import { MAX_NATIVE_ATTACHMENT_TOTAL_BYTES } from "@/lib/weknora/fred-native";

import {
  assertFredNativeFileTotalSize,
  fredAttachmentAggregateByteLimit,
  fredMultipartRequestByteLimit,
  MAX_FRED_NATIVE_MULTIPART_BYTES,
  MAX_FRED_PREPROCESSED_MULTIPART_BYTES,
} from "./fred-upload-limits";

describe("Fred multipart upload limits", () => {
  it("bounds native multipart input close to its actual 35 MiB aggregate limit", () => {
    expect(MAX_FRED_NATIVE_MULTIPART_BYTES).toBe(
      MAX_NATIVE_ATTACHMENT_TOTAL_BYTES + 64 * 1_024 + 1_024 * 1_024,
    );
    expect(fredMultipartRequestByteLimit(true)).toBe(MAX_FRED_NATIVE_MULTIPART_BYTES);
    expect(fredMultipartRequestByteLimit(false)).toBe(MAX_FRED_PREPROCESSED_MULTIPART_BYTES);
    expect(fredAttachmentAggregateByteLimit(true)).toBe(MAX_NATIVE_ATTACHMENT_TOTAL_BYTES);
    expect(fredAttachmentAggregateByteLimit(false)).toBe(MAX_NATIVE_ATTACHMENT_TOTAL_BYTES);
    expect(MAX_FRED_NATIVE_MULTIPART_BYTES).toBe(MAX_FRED_PREPROCESSED_MULTIPART_BYTES);
  });

  it("accepts exactly 35 MiB and rejects one aggregate byte more before provider work", () => {
    expect(() => assertFredNativeFileTotalSize([
      { size: 20 * 1_024 * 1_024 },
      { size: 15 * 1_024 * 1_024 },
    ])).not.toThrow();

    expect(() => assertFredNativeFileTotalSize([
      { size: 20 * 1_024 * 1_024 },
      { size: 15 * 1_024 * 1_024 + 1 },
    ])).toThrow("Die Fred-Anhänge sind zusammen zu groß");
  });
});
