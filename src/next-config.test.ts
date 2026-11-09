import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { MAX_FILE_BYTES } from "@/lib/attachments/validation";
import {
  MAX_FRED_NATIVE_MULTIPART_BYTES,
  MAX_FRED_PREPROCESSED_MULTIPART_BYTES,
} from "@/lib/attachments/fred-upload-limits";
import { MAX_FORM_MULTIPART_BYTES } from "@/lib/forms/config";
import { MAX_SCANNING_MULTIPART_BYTES } from "@/lib/scanning/config";

describe("next config proxy body limit", () => {
  it("covers every legitimate upload route limit so the proxy never truncates them", () => {
    const limit = nextConfig.experimental?.proxyClientMaxBodySize;
    expect(typeof limit).toBe("number");
    for (const routeLimit of [
      MAX_FILE_BYTES,
      MAX_FRED_NATIVE_MULTIPART_BYTES,
      MAX_FRED_PREPROCESSED_MULTIPART_BYTES,
      MAX_FORM_MULTIPART_BYTES,
      MAX_SCANNING_MULTIPART_BYTES,
    ]) {
      expect(limit as number).toBeGreaterThan(routeLimit);
    }
  });
});
