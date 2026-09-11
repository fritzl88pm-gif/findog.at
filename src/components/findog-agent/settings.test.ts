// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminGuardContext, useAdminNavigationGuard } from "@/components/admin-editor-guard";
import FindogAgentSettings from "./settings";
import { createHost, jsonResponse, type TestHost } from "./ui-test-helpers";

const REDACTED_SETTINGS = {
  schemaVersion: 1,
  agentName: "Findog Agent (Preview)",
  systemPrompt: "Recherchiere gründlich.",
  enabled: true,
  activeModelId: "model-1",
  connections: [
    {
      id: "conn-1",
      name: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyConfigured: true,
    },
  ],
  models: [
    {
      id: "model-1",
      label: "Flash",
      connectionId: "conn-1",
      model: "deepseek-flash",
      reasoningEffort: "high",
      capabilities: ["tools", "reasoning"],
      maxOutputTokens: 8192,
      contextTokens: 128000,
      inputCostPerMillionUsd: null,
      outputCostPerMillionUsd: null,
    },
  ],
  knowledge: { enabled: false, baseUrl: null, knowledgeBaseIds: [], apiKeyConfigured: false },
  web: {
    mode: "off",
    allowedDomains: ["example.at"],
    maxResults: 5,
    maxTextCharacters: 20000,
    exaApiKeyConfigured: false,
  },
  mcp: {
    servers: [
      { id: "mcp-1", name: "Dokumentation", url: "https://mcp.example/mcp", allowedTools: [], bearerConfigured: false },
    ],
  },
  limits: {
    requestTimeoutSeconds: 120,
    deadlineSeconds: 600,
    maxSteps: 12,
    maxToolCalls: 24,
    maxOutputTokens: 8192,
    estimatedCostLimitUsd: null,
  },
};

const SETTINGS_URL = "/api/admin/findog-agent/settings";
const TESTS_URL = "/api/admin/findog-agent/connection-tests";

type Call = { url: string; method: string; body: Record<string, unknown> | null };

let view: TestHost;
let calls: Call[];
const fetchMock = vi.fn();

function handlerFor(routes: (url: string, call: Call) => Response | null) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null,
    };
    calls.push(call);
    const response = routes(url, call);
    if (!response) {
      throw new Error(`Unerwartete Anfrage: ${call.method} ${url}`);
    }
    return response;
  });
}

function settingsResponse(revision: number | null, settings: Record<string, unknown>, status = 200) {
  return jsonResponse({ revision, updatedAt: "2026-09-01T10:00:00.000Z", settings }, status);
}

function Harness({ accessToken }: { accessToken: string }) {
  const guard = useAdminNavigationGuard();
  return createElement(
    AdminGuardContext.Provider,
    { value: guard },
    createElement(FindogAgentSettings, { accessToken }),
  );
}

async function renderSettings(node?: ReactNode) {
  await view.render(node ?? createElement(Harness, { accessToken: "fixture-token" }));
}

function checkboxFor(label: string): HTMLInputElement {
  const entry = [...view.host.querySelectorAll("label")].find((node) => node.textContent?.includes(label));
  const input = entry?.querySelector("input[type=checkbox]");
  if (!input) {
    throw new Error(`Kontrollkästchen nicht gefunden: ${label}`);
  }
  return input as HTMLInputElement;
}

function lastWrite(url: string): Call | undefined {
  return [...calls].reverse().find((call) => call.url === url && call.method !== "GET");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock.mockReset());
  calls = [];
  view = createHost();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(async () => {
  await view.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Findog Agent settings", () => {
  it("renders grouped real inputs instead of a raw JSON editor and reads only the configuration", async () => {
    handlerFor((url) => (url === SETTINGS_URL ? settingsResponse(4, REDACTED_SETTINGS) : null));
    await renderSettings();
    expect(view.host.textContent).toContain("Revision 4");
    expect((view.host.querySelector("#findog-agent-name") as HTMLInputElement).value).toBe("Findog Agent (Preview)");
    expect((view.host.querySelector("#findog-agent-prompt") as HTMLTextAreaElement).value).toBe("Recherchiere gründlich.");
    expect(view.host.querySelector("#findog-agent-knowledge-url")).not.toBeNull();
    expect(view.host.querySelector("#findog-agent-web-domains")).not.toBeNull();
    expect(view.host.querySelector("#findog-agent-steps")).not.toBeNull();
    expect(view.host.querySelector("#mcp-url-mcp-1")).not.toBeNull();
    expect(view.host.textContent).not.toContain("schemaVersion");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("offers no nonfunctional streaming capability toggle while keeping tools and reasoning", async () => {
    handlerFor((url) => (url === SETTINGS_URL ? settingsResponse(4, REDACTED_SETTINGS) : null));
    await renderSettings();
    const capabilityLabels = [...view.host.querySelectorAll("label")]
      .filter((node) => node.querySelector("input[type=checkbox]"))
      .map((node) => node.textContent?.trim());
    expect(capabilityLabels).toContain("Werkzeuge");
    expect(capabilityLabels).toContain("Reasoning");
    expect(view.host.textContent).not.toContain("Streaming");
    // The UI documents the actual behaviour: complete responses observed by polling.
    expect(view.host.textContent).toContain("Polling");
  });

  it("saves the settings with the expected revision, without redaction flags or paid tests", async () => {
    handlerFor((url, call) => {
      if (url !== SETTINGS_URL) {
        return null;
      }
      if (call.method === "GET") {
        return settingsResponse(4, REDACTED_SETTINGS);
      }
      return settingsResponse(5, { ...REDACTED_SETTINGS, agentName: "Neuer Name" });
    });
    await renderSettings();
    await view.type("#findog-agent-name", "Neuer Name");
    await view.click(view.button("Speichern"));

    const put = lastWrite(SETTINGS_URL);
    expect(put?.body?.expectedRevision).toBe(4);
    expect(put?.body?.secrets).toEqual({});
    const payload = put?.body?.settings as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain("apiKeyConfigured");
    expect((payload.connections as Array<{ id: string }>)[0]?.id).toBe("conn-1");
    expect(payload.activeModelId).toBe("model-1");
    expect(view.host.textContent).toContain("Revision 5 gespeichert");
    expect(calls.some((call) => call.url === TESTS_URL)).toBe(false);
  });

  it("keeps the edit and explains the conflict when the revision is stale", async () => {
    handlerFor((url, call) => {
      if (url !== SETTINGS_URL) {
        return null;
      }
      return call.method === "GET"
        ? settingsResponse(4, REDACTED_SETTINGS)
        : jsonResponse({ error: "Die Konfiguration wurde zwischenzeitlich geändert. Bitte neu laden.", code: "conflict" }, 409);
    });
    await renderSettings();
    await view.type("#findog-agent-name", "Konflikt");
    await view.click(view.button("Speichern"));
    expect(view.host.textContent).toContain("zwischenzeitlich geändert");
    expect((view.host.querySelector("#findog-agent-name") as HTMLInputElement).value).toBe("Konflikt");
    expect(view.host.textContent).toContain("Ungespeicherte Änderungen");
  });

  it("guards unsaved changes and releases the guard once the request failed", async () => {
    handlerFor((url, call) => {
      if (url !== SETTINGS_URL) {
        return null;
      }
      return call.method === "GET"
        ? settingsResponse(4, REDACTED_SETTINGS)
        : jsonResponse({ error: "Speichern fehlgeschlagen" }, 500);
    });
    await renderSettings();
    await view.type("#findog-agent-name", "Ungespeichert");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await view.click(view.button("Speichern"));
    expect(view.host.textContent).toContain("Speichern fehlgeschlagen");
    // The failed request must not trap the user: saving is no longer in flight.
    expect(view.button("Speichern").disabled).toBe(false);
  });

  it("replaces, removes and never blanks stored secrets", async () => {
    let written: Record<string, unknown> | null = null;
    handlerFor((url, call) => {
      if (url === SETTINGS_URL && call.method === "PUT") {
        written = call.body?.secrets as Record<string, unknown>;
        return settingsResponse(5, REDACTED_SETTINGS);
      }
      return url === SETTINGS_URL ? settingsResponse(4, REDACTED_SETTINGS) : null;
    });
    await renderSettings();

    await view.click(view.button("Speichern"));
    expect(written).toEqual({});

    await view.type('input[aria-label="Zugangsschlüssel für DeepSeek"]', "sk-neuer-wert");
    await view.click(view.button("Speichern"));
    expect(written).toEqual({ "connection:conn-1:apiKey": "sk-neuer-wert" });

    await view.click(view.button("Wert entfernen"));
    await view.click(view.button("Speichern"));
    expect(written).toEqual({ "connection:conn-1:apiKey": null });
    expect(view.host.textContent).toContain("nicht hinterlegt");
  });

  it("lists discovered knowledge bases and MCP tools and stores the explicit selection", async () => {
    handlerFor((url, call) => {
      if (url === TESTS_URL) {
        const kind = call.body?.kind;
        if (kind === "weknora") {
          return jsonResponse({
            ok: true,
            kind: "weknora",
            id: null,
            summary: "2 Wissensbasis(en) gefunden.",
            latencyMs: 11,
            code: null,
            detail: {
              knowledgeBases: [
                { id: "kb-1", name: "Handbuch", configured: false },
                { id: "kb-2", name: "Gesetze", configured: false },
              ],
              listed: 2,
              total: 3,
            },
          });
        }
        return jsonResponse({
          ok: true,
          kind: "mcp",
          id: "mcp-1",
          summary: "1 MCP-Werkzeug(e) gefunden.",
          latencyMs: 21,
          code: null,
          detail: {
            tools: [
              { name: "docs_search", description: "Sucht in der Dokumentation", approved: false, readOnlyHint: true },
            ],
            listed: 1,
            total: 1,
          },
        });
      }
      if (url === SETTINGS_URL && call.method === "PUT") {
        return settingsResponse(5, REDACTED_SETTINGS);
      }
      return url === SETTINGS_URL ? settingsResponse(4, REDACTED_SETTINGS) : null;
    });
    await renderSettings();

    await view.click(view.button("Wissensbasen laden"));
    expect(view.host.textContent).toContain("Handbuch");
    expect(view.host.textContent).toContain("2 von 3 Einträgen angezeigt; die Liste ist gekürzt.");
    await view.click(checkboxFor("Handbuch"));

    await view.click(view.button("Werkzeuge laden"));
    expect(view.host.textContent).toContain("docs_search");
    expect(view.host.textContent).toContain("vom Server als schreibgeschützt gekennzeichnet");
    await view.click(checkboxFor("docs_search"));

    await view.click(view.button("Speichern"));
    const payload = lastWrite(SETTINGS_URL)?.body?.settings as Record<string, unknown>;
    expect((payload.knowledge as { knowledgeBaseIds: string[] }).knowledgeBaseIds).toEqual(["kb-1"]);
    expect(
      ((payload.mcp as { servers: Array<{ allowedTools: string[] }> }).servers[0]?.allowedTools),
    ).toEqual(["docs_search"]);
  });

  it("runs deliberate connection tests against the saved revision and warns about token usage", async () => {
    handlerFor((url, call) => {
      if (url === TESTS_URL) {
        return jsonResponse({
          ok: true,
          kind: "model",
          id: "model-1",
          summary: "Das Modell hat geantwortet.",
          latencyMs: 34,
          code: null,
          detail: { finishReason: "stop", answered: true, promptTokens: 12, completionTokens: 3 },
        });
      }
      return url === SETTINGS_URL && call.method === "GET" ? settingsResponse(4, REDACTED_SETTINGS) : null;
    });
    await renderSettings();
    expect(view.host.textContent).toContain("kann Token verbrauchen");
    await view.click(view.button("Modell testen"));
    const test = lastWrite(TESTS_URL);
    expect(test?.body).toEqual({ revision: 4, kind: "model", id: "model-1" });
    expect(view.host.textContent).toContain("Das Modell hat geantwortet.");
    expect(view.host.textContent).toContain("Ausgabe-Tokens: 3");
  });

  it("blocks tests without a saved revision and clears state when access is denied", async () => {
    handlerFor((url) => (url === SETTINGS_URL ? settingsResponse(null, REDACTED_SETTINGS) : null));
    await renderSettings();
    expect(view.button("Modell testen").disabled).toBe(true);
    expect(view.host.textContent).toContain("erst nach dem ersten Speichern möglich");
    expect(calls.some((call) => call.url === TESTS_URL)).toBe(false);

    await view.unmount();
    view = createHost();
    handlerFor((url) => (url === SETTINGS_URL ? jsonResponse({ error: "Du hast keine Administrationsberechtigung." }, 403) : null));
    await renderSettings();
    expect(view.host.textContent).toContain("Administrationsberechtigung");
    expect(view.host.querySelector("#findog-agent-name")).toBeNull();
  });
});
