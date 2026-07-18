import { describe, expect, it } from "vitest";

import {
  AVAILABLE_MODELS,
  MODEL_CATALOG,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  MAX_REQUEST_BYTES,
  isSupportedModel,
} from "./config";

describe("request bounds", () => {
  it("keeps JSON requests bounded separately from PDF multipart uploads", () => {
    expect(MAX_REQUEST_BYTES).toBe(400_000);
    expect(MAX_PDF_UPLOAD_BYTES).toBe(50_000_000);
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(5_000_000);
    expect(MAX_PDF_UPLOADS).toBe(5);
    expect(MAX_IMAGE_UPLOADS).toBe(5);
    expect(MAX_MULTIPART_REQUEST_BYTES).toBeGreaterThanOrEqual(
      MAX_REQUEST_BYTES
        + MAX_PDF_UPLOAD_BYTES * MAX_PDF_UPLOADS
        + MAX_IMAGE_UPLOAD_BYTES * MAX_IMAGE_UPLOADS,
    );
  });
});

describe("model policy", () => {
  it("supports the fixed provider catalog without a privileged built-in default", () => {
    expect(AVAILABLE_MODELS).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "glm-5.2",
      "glm-5-turbo",
    ]);
    expect(MODEL_CATALOG["deepseek-v4-flash"]).toMatchObject({
      alwaysEnabled: false,
      defaultReasoning: "disabled",
    });
    expect(Object.values(MODEL_CATALOG).every((model) => !model.alwaysEnabled)).toBe(true);
    expect(MODEL_CATALOG["deepseek-v4-pro"].defaultReasoning).toBe("high");
    expect(MODEL_CATALOG["glm-5.2"].defaultReasoning).toBe("max");
    expect(MODEL_CATALOG["glm-5-turbo"].reasoningOptions).toEqual(["disabled", "enabled"]);
    expect(isSupportedModel("deepseek-v4-pro")).toBe(true);
    expect(isSupportedModel("deepseek-v4-flash")).toBe(true);
    expect(isSupportedModel("glm-5.2")).toBe(true);
    expect(isSupportedModel("glm-5-turbo")).toBe(true);
    expect(isSupportedModel("deepseek-chat")).toBe(false);
    expect(isSupportedModel("obsolete-client-model")).toBe(false);
  });
});
