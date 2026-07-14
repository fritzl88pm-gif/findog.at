import { afterEach, describe, expect, it } from "vitest";

import { UserVisibleError } from "../errors";
import {
  isModelProviderConfigured,
  resolveLlmRuntime,
  withRuntimeReasoning,
} from "./runtime";

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalGlobalDeepSeekKey = process.env.GLOBAL_DEEPSEEK_API_KEY;
const originalZaiKey = process.env.ZAI_API_KEY;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("DEEPSEEK_API_KEY", originalDeepSeekKey);
  restore("GLOBAL_DEEPSEEK_API_KEY", originalGlobalDeepSeekKey);
  restore("ZAI_API_KEY", originalZaiKey);
});

describe("resolveLlmRuntime", () => {
  it("resolves Flash as the fast DeepSeek default without exposing another provider", () => {
    process.env.DEEPSEEK_API_KEY = "  deepseek-secret  ";

    expect(resolveLlmRuntime({ model: "deepseek-v4-flash" })).toEqual({
      model: "deepseek-v4-flash",
      provider: "deepseek",
      upstreamModel: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      apiKey: "deepseek-secret",
      reasoning: "disabled",
    });
  });

  it("routes GLM models only through the authorized Z.AI Coding endpoint and key", () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    process.env.ZAI_API_KEY = "  zai-secret  ";

    expect(resolveLlmRuntime({ model: "glm-5.2" })).toEqual({
      model: "glm-5.2",
      provider: "zai",
      upstreamModel: "glm-5.2",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiKey: "zai-secret",
      reasoning: "max",
    });
  });

  it("rejects unsupported per-model reasoning instead of silently remapping it", () => {
    process.env.ZAI_API_KEY = "zai-secret";

    expect(() => resolveLlmRuntime({
      model: "glm-5-turbo",
      reasoning: "high",
    })).toThrow(UserVisibleError);
  });

  it("never falls back from a missing Z.AI key to the DeepSeek key", () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    delete process.env.ZAI_API_KEY;

    expect(isModelProviderConfigured("glm-5.2")).toBe(false);
    expect(() => resolveLlmRuntime({ model: "glm-5.2" })).toThrow(
      "Serverseitige Z.AI-Konfiguration fehlt",
    );
  });

  it("allows a capability-valid runtime-local reasoning override", () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    const runtime = resolveLlmRuntime({ model: "deepseek-v4-pro" });

    expect(withRuntimeReasoning(runtime, "max")).toEqual({
      ...runtime,
      reasoning: "max",
    });
  });
});
