import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encryptFindogAgentSecret } from "./credentials";
import {
  createDefaultFindogAgentSettings,
  listFindogAgentSecretNames,
  normalizeFindogAgentSettings,
  toRedactedFindogAgentSettings,
} from "./settings";
import type { FindogAgentSettings } from "./types";

const KEY = Buffer.alloc(32, 3).toString("base64");

function validSettings(): FindogAgentSettings {
  return {
    ...createDefaultFindogAgentSettings(),
    agentName: "Findog Agent",
    systemPrompt: "Recherchiere gründlich.",
    connections: [
      {
        id: "primary",
        name: "DeepSeek",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
      },
    ],
    models: [
      {
        id: "flash",
        label: "DeepSeek V4.1 Flash",
        connectionId: "primary",
        model: "deepseek-flash",
        reasoningEffort: "high",
        capabilities: ["tools", "reasoning"],
        maxOutputTokens: 8192,
        contextTokens: 128000,
        inputCostPerMillionUsd: null,
        outputCostPerMillionUsd: null,
      },
    ],
    activeModelId: "flash",
  };
}

describe("findog agent settings", () => {
  beforeEach(() => {
    process.env.FINDOG_AGENT_CREDENTIALS_KEY = KEY;
  });

  afterEach(() => {
    delete process.env.FINDOG_AGENT_CREDENTIALS_KEY;
  });

  it("ships conservative defaults with no preselected paid runtime model", () => {
    const defaults = createDefaultFindogAgentSettings();
    expect(defaults.enabled).toBe(false);
    expect(defaults.activeModelId).toBeNull();
    expect(defaults.connections).toEqual([]);
    expect(defaults.models).toEqual([]);
    expect(defaults.web.mode).toBe("off");
    expect(defaults.knowledge.enabled).toBe(false);
    expect(defaults.mcp.servers).toEqual([]);
    expect(defaults.limits.maxSteps).toBeGreaterThan(0);
  });

  it("normalizes a valid configuration and keeps only known fields", () => {
    const normalized = normalizeFindogAgentSettings(validSettings());
    expect(normalized.activeModelId).toBe("flash");
    expect(normalized.connections).toHaveLength(1);
    expect(normalized.models[0].capabilities).toEqual(["tools", "reasoning"]);
    expect(normalized.schemaVersion).toBe(1);
  });

  it("rejects server environment lookup fields instead of reading arbitrary secrets", () => {
    const withEnv = {
      ...validSettings(),
      apiKeyEnv: "OPENAI_API_KEY",
      connections: [
        {
          id: "primary",
          name: "DeepSeek",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
        },
      ],
    };
    expect(() => normalizeFindogAgentSettings(withEnv)).toThrowError(/apiKeyEnv/);
  });

  it("rejects malformed values", () => {
    expect(() => normalizeFindogAgentSettings(null)).toThrowError(/ungültig/);
    expect(() => normalizeFindogAgentSettings({ ...validSettings(), schemaVersion: 2 }))
      .toThrowError(/ungültig/);
    expect(() => normalizeFindogAgentSettings({ ...validSettings(), enabled: "yes" }))
      .toThrowError(/ungültig/);
    expect(() => normalizeFindogAgentSettings({
      ...validSettings(),
      models: [{ ...validSettings().models[0], capabilities: ["shell"] }],
    })).toThrowError(/ungültig/);
    expect(() => normalizeFindogAgentSettings({
      ...validSettings(),
      models: [{ ...validSettings().models[0], connectionId: "missing" }],
    })).toThrowError(/verbunden/);
    expect(() => normalizeFindogAgentSettings({ ...validSettings(), activeModelId: "nope" }))
      .toThrowError(/aktiv/);
    expect(() => normalizeFindogAgentSettings({
      ...validSettings(),
      connections: [
        validSettings().connections[0],
        { ...validSettings().connections[0], name: "Duplicate" },
      ],
    })).toThrowError(/doppelt/);
  });

  it("rejects credential-bearing or insecure endpoints", () => {
    const withUserInfo = validSettings();
    withUserInfo.connections = [{
      ...withUserInfo.connections[0],
      baseUrl: "https://user:pass@api.deepseek.com/v1",
    }];
    expect(() => normalizeFindogAgentSettings(withUserInfo)).toThrowError(/ungültig/);

    const withQuery = validSettings();
    withQuery.connections = [{
      ...withQuery.connections[0],
      baseUrl: "https://api.deepseek.com/v1?api_key=leak",
    }];
    expect(() => normalizeFindogAgentSettings(withQuery)).toThrowError(/ungültig/);

    const insecure = validSettings();
    insecure.connections = [{ ...insecure.connections[0], baseUrl: "http://api.deepseek.com/v1" }];
    expect(() => normalizeFindogAgentSettings(insecure)).toThrowError(/ungültig/);
    expect(normalizeFindogAgentSettings(insecure, { allowInsecureHttp: true }).connections[0].baseUrl)
      .toBe("http://api.deepseek.com/v1");
  });

  it("returns a redacted DTO without plaintext or ciphertext", () => {
    const settings = normalizeFindogAgentSettings({
      ...validSettings(),
      knowledge: { enabled: true, baseUrl: "https://weknora.example.com/api/v1", knowledgeBaseIds: ["kb-1"] },
      mcp: { servers: [{ id: "docs", name: "Docs", url: "https://mcp.example.com/mcp", allowedTools: ["search"] }] },
    });
    const encrypted = {
      "connection:primary:apiKey": encryptFindogAgentSecret("sk-live-plaintext"),
      "knowledge:apiKey": encryptFindogAgentSecret("wk-plaintext"),
      "web:exaApiKey": encryptFindogAgentSecret("exa-plaintext"),
      "mcp:docs:bearer": encryptFindogAgentSecret("mcp-plaintext"),
    };
    const redacted = toRedactedFindogAgentSettings(settings, encrypted);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("plaintext");
    expect(serialized).not.toContain("v1.");
    expect(redacted.connections[0]).toEqual({
      id: "primary",
      name: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyConfigured: true,
    });
    expect(redacted.knowledge.apiKeyConfigured).toBe(true);
    expect(redacted.web.exaApiKeyConfigured).toBe(true);
    expect(redacted.mcp.servers[0].bearerConfigured).toBe(true);

    const empty = toRedactedFindogAgentSettings(settings, {});
    expect(empty.connections[0].apiKeyConfigured).toBe(false);
    expect(empty.knowledge.apiKeyConfigured).toBe(false);
  });

  it("lists only secret names that belong to the configured catalog", () => {
    const settings = normalizeFindogAgentSettings({
      ...validSettings(),
      knowledge: { enabled: true, baseUrl: "https://weknora.example.com/api/v1", knowledgeBaseIds: ["kb-1"] },
      mcp: { servers: [{ id: "docs", name: "Docs", url: "https://mcp.example.com/mcp", allowedTools: ["search"] }] },
    });
    expect(listFindogAgentSecretNames(settings).sort()).toEqual([
      "connection:primary:apiKey",
      "knowledge:apiKey",
      "mcp:docs:bearer",
      "web:exaApiKey",
    ]);
  });
});
