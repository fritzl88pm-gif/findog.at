import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { UserVisibleError } from "../errors";
import { encryptOpenAICompatibleApiKey } from "../openai-compatible-credentials";
import {
  isModelProviderConfigured,
  resolveDynamicLlmRuntime,
  resolveLlmRuntime,
  withRuntimeReasoning,
} from "./runtime";

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalGlobalDeepSeekKey = process.env.GLOBAL_DEEPSEEK_API_KEY;
const originalZaiKey = process.env.ZAI_API_KEY;
const originalCompatibleKey = process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY;

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
  restore("OPENAI_COMPATIBLE_CREDENTIALS_KEY", originalCompatibleKey);
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
      label: "DeepSeek v4 Flash",
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
      label: "GLM-5.2",
    });
  });

  it("resolves a custom runtime from its own base URL and encrypted key", () => {
    process.env.OPENAI_COMPATIBLE_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    const runtime = resolveDynamicLlmRuntime({
      id: "openai:00000000-0000-4000-8000-000000000001",
      displayName: null,
      provider: "openai_compatible",
      upstreamModel: "vendor-model",
      baseUrl: "https://gateway.example.com/v1",
      accessScope: "all",
      apiKeyCiphertext: encryptOpenAICompatibleApiKey("provider-secret"),
      isDynamic: true,
      alwaysEnabled: false,
      enabled: true,
      reasoning: "disabled",
      revision: 5,
      updatedAt: null,
      updatedBy: null,
    });

    expect(runtime).toEqual({
      model: "openai:00000000-0000-4000-8000-000000000001",
      provider: "openai_compatible",
      upstreamModel: "vendor-model",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "provider-secret",
      reasoning: "disabled",
      label: "OpenAI-kompatibles Modell",
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
