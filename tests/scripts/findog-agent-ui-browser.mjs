/**
 * Native browser verification for the Findog Agent UI (Package 3).
 *
 * Serves the fixture harness (real chat/settings/workspace components with the
 * real stylesheets) from a throwaway local HTTP server, answers every agent API
 * call with seeded synthetic fixtures and drives the real UI in Chromium.
 *
 * This proves rendering and interaction only: it does NOT prove live provider
 * behaviour, real databases or production authentication. No production auth
 * bypass, no real user and no live credential is used.
 *
 * Usage:
 *   node tests/fixtures/findog-agent-ui/build.mjs
 *   node tests/scripts/findog-agent-ui-browser.mjs
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/data/.cache/ms-playwright";
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ?? "/opt/data/tmp/fredrun-browser-tools/node_modules/playwright/index.mjs";
const { chromium } = await import(playwrightModule);

const here = dirname(fileURLToPath(import.meta.url));
const distDirectory = resolve(here, "../fixtures/findog-agent-ui/dist");
const evidenceDirectory = process.env.FINDOG_AGENT_EVIDENCE
  ?? "/opt/data/tmp/findog-independent-agent/package3-evidence";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = path === "/" ? "index.html" : path.replace(/^\/+/, "");
    try {
      const body = await readFile(join(distDirectory, file));
      response.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => done({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

// --------------------------------------------------------------------------
// Seeded synthetic fixtures (UI-only; every value is labeled fixture data)
// --------------------------------------------------------------------------

const NOW = "2026-09-01T10:00:00.000Z";
const SEEDED_CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const ANSWER_TEXT = "Der Satz beträgt 10 Prozent [src_1].";
const QUESTION = "Wie hoch ist die Umsatzsteuer auf Software?";

const SOURCE = {
  id: "src_1",
  kind: "knowledge",
  provider: "weknora",
  title: "Merkblatt Steuer",
  text: "Der Satz beträgt 10 Prozent.",
  truncated: false,
  url: "https://example.test/merkblatt",
  retrievedAt: NOW,
  provenance: { knowledgeBaseId: "kb-1", chunkId: "chunk-7" },
};
const USAGE = {
  modelCalls: 2,
  promptTokens: 1000,
  completionTokens: 200,
  toolCalls: 1,
  knowledgeRetrievals: 1,
  webRetrievals: 0,
  mcpCalls: 0,
};
const COST = {
  limitUsd: null,
  limitStatus: "not_configured",
  totalEstimatedUsd: 0.0123,
  coverage: { model: "estimated", web: "unused", knowledge: "uncovered", mcp: "unused" },
};
const REDACTED_SETTINGS = {
  schemaVersion: 1,
  agentName: "Findog Agent (Preview)",
  systemPrompt: "Recherchiere gründlich und belege jede Aussage mit Quellen.",
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
      label: "DeepSeek V4.1 Flash",
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
  knowledge: { enabled: true, baseUrl: "https://weknora.example/api/v1", knowledgeBaseIds: [], apiKeyConfigured: true },
  web: {
    mode: "auto",
    allowedDomains: ["example.at"],
    maxResults: 5,
    maxTextCharacters: 20000,
    exaApiKeyConfigured: false,
  },
  mcp: {
    servers: [
      { id: "mcp-1", name: "Dokumentation", url: "https://mcp.example/mcp", allowedTools: [], bearerConfigured: true },
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

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

function createFixture() {
  const addConversation = (id, title) => {
    fixture.conversations.set(id, { id, title, createdAt: NOW, updatedAt: NOW });
    fixture.messages.set(id, []);
  };

  const runEvents = () => [
    { sequence: 1, kind: "status", payload: { phase: "preparing" }, createdAt: NOW },
    {
      sequence: 2,
      kind: "plan",
      payload: { steps: ["Wissensdatenbank durchsuchen", "Beleg prüfen und antworten"], notes: null },
      createdAt: NOW,
    },
    { sequence: 3, kind: "tool_call", payload: { step: 1, tool: "knowledge_search" }, createdAt: NOW },
    {
      sequence: 4,
      kind: "tool_result",
      payload: { step: 1, tool: "knowledge_search", ok: true, summary: "1 Treffer", sourceIds: ["src_1"] },
      createdAt: NOW,
    },
    {
      sequence: 5,
      kind: "source",
      payload: { id: "src_1", kind: "knowledge", provider: "weknora", title: "Merkblatt Steuer", truncated: false },
      createdAt: NOW,
    },
    { sequence: 6, kind: "usage", payload: { ...USAGE, cost: COST }, createdAt: NOW },
  ];

  const startRun = (conversationId, question, conversationTitle) => {
    if (!fixture.conversations.has(conversationId)) {
      addConversation(conversationId, conversationTitle ?? question.slice(0, 40));
    }
    const run = {
      id: randomUUID(),
      conversationId,
      state: "running",
      cancelRequested: false,
      attemptCount: 1,
      settingsRevision: fixture.revision,
      createdAt: NOW,
      updatedAt: NOW,
      startedAt: NOW,
      finishedAt: null,
      result: null,
      error: null,
      usage: null,
      cost: null,
    };
    fixture.runs.set(run.id, run);
    fixture.events.set(run.id, runEvents());
    fixture.activeRun.set(conversationId, run.id);
    fixture.messages.get(conversationId).push({
      id: `user-${run.id}`,
      role: "user",
      content: question,
      runId: run.id,
      isPartial: false,
      createdAt: NOW,
    });
    return run;
  };

  const finishRun = (runId) => {
    const run = fixture.runs.get(runId);
    run.state = "succeeded";
    run.finishedAt = NOW;
    run.result = {
      answer: ANSWER_TEXT,
      citations: { citedSourceIds: ["src_1"], unknownSourceIds: [] },
      sources: [SOURCE],
      plan: { steps: ["Wissensdatenbank durchsuchen"], notes: null },
      notices: [],
      context: { truncated: false, droppedHistoryMessages: 0, estimatedInputTokens: 900, contextTokens: 128000 },
      webResearchPerformed: false,
      trace: [],
    };
    run.usage = USAGE;
    run.cost = COST;
    fixture.messages.get(run.conversationId).push({
      id: `assistant-${run.id}`,
      role: "assistant",
      content: ANSWER_TEXT,
      runId: run.id,
      isPartial: false,
      createdAt: NOW,
    });
    fixture.activeRun.delete(run.conversationId);
    return run;
  };

  const fixture = {
    revision: 4,
    settings: structuredClone(REDACTED_SETTINGS),
    conversations: new Map(),
    messages: new Map(),
    runs: new Map(),
    events: new Map(),
    activeRun: new Map(),
    historyHasMore: true,
    forceMessagesTruncated: true,
    failNextEnqueue: false,
    conflictNextWrite: false,
    denyNext: false,
    enqueues: [],
    stopCount: 0,
    settingsWrites: [],
    testCalls: [],
    startRun,
  };

  // Seed one finished research with persisted sources, usage and cost.
  addConversation(SEEDED_CONVERSATION_ID, "Steuerfrage");
  finishRun(startRun(SEEDED_CONVERSATION_ID, "Wie hoch ist die Steuer?", null).id);
  return fixture;
}

// --------------------------------------------------------------------------
// Fixture API router (mirrors the frozen backend DTOs, no business logic)
// --------------------------------------------------------------------------

const API_PREFIX = "/api/admin/findog-agent";

function applySettingsWrite(previous, body) {
  const settings = body.settings;
  const secrets = body.secrets ?? {};
  // Omitted secret keeps the stored flag, `null` removes it, a value replaces it.
  const flag = (patch, before) => (patch === null ? false : patch === undefined ? before : true);
  return {
    ...previous,
    schemaVersion: settings.schemaVersion,
    agentName: settings.agentName,
    systemPrompt: settings.systemPrompt,
    enabled: settings.enabled,
    activeModelId: settings.activeModelId,
    connections: settings.connections.map((connection) => ({
      ...connection,
      apiKeyConfigured: flag(
        secrets[`connection:${connection.id}:apiKey`],
        previous.connections.find((entry) => entry.id === connection.id)?.apiKeyConfigured ?? false,
      ),
    })),
    models: settings.models.map((model) => ({ ...model })),
    knowledge: {
      ...settings.knowledge,
      apiKeyConfigured: flag(secrets["knowledge:apiKey"], previous.knowledge.apiKeyConfigured),
    },
    web: {
      ...settings.web,
      exaApiKeyConfigured: flag(secrets["web:exaApiKey"], previous.web.exaApiKeyConfigured),
    },
    mcp: {
      servers: settings.mcp.servers.map((server) => ({
        ...server,
        bearerConfigured: flag(
          secrets[`mcp:${server.id}:bearer`],
          previous.mcp.servers.find((entry) => entry.id === server.id)?.bearerConfigured ?? false,
        ),
      })),
    },
    limits: { ...settings.limits },
  };
}

function connectionTestResult(kind, id) {
  if (kind === "model") {
    return {
      ok: true, kind, id, summary: "Das Modell hat geantwortet.", latencyMs: 123, code: null,
      detail: { finishReason: "stop", answered: true, promptTokens: 41, completionTokens: 7 },
    };
  }
  if (kind === "weknora") {
    return {
      ok: true, kind, id: null, summary: "2 Wissensbasis(en) gefunden.", latencyMs: 88, code: null,
      detail: {
        knowledgeBases: [
          { id: "kb-1", name: "Handbuch", configured: true },
          { id: "kb-2", name: "Steuer", configured: false },
        ],
        listed: 2,
        total: 2,
      },
    };
  }
  if (kind === "exa") {
    return {
      ok: true, kind, id: null, summary: "Die Websuche hat geantwortet.", latencyMs: 210, code: null,
      detail: { hits: 3, filtered: 1, estimatedCostUsd: 0.0025, sampleUrls: ["https://example.test/a"] },
    };
  }
  return {
    ok: true, kind: "mcp", id, summary: "2 MCP-Werkzeug(e) gefunden.", latencyMs: 64, code: null,
    detail: {
      tools: [
        { name: "search_documents", description: "Sucht Dokumente.", approved: false, readOnlyHint: true },
        { name: "read_document", description: "Liest ein Dokument.", approved: false, readOnlyHint: true },
      ],
      listed: 2,
      total: 2,
    },
  };
}

function conversationView(fixture, conversationId) {
  const activeRunId = fixture.activeRun.get(conversationId);
  const run = activeRunId ? fixture.runs.get(activeRunId) : null;
  return {
    conversation: fixture.conversations.get(conversationId),
    messages: (fixture.messages.get(conversationId) ?? []).slice(-50),
    messagesTruncated: fixture.forceMessagesTruncated,
    limit: 50,
    activeRun: run && !TERMINAL_STATES.has(run.state) ? run : null,
  };
}

function send(route, status, body) {
  return route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
}

async function handleApi(route, fixture) {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.slice(API_PREFIX.length);
  let body = null;
  if (method !== "GET") {
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
  }

  if (fixture.denyNext) {
    fixture.denyNext = false;
    return send(route, 403, { error: "Kein Zugriff auf den Findog Agent." });
  }

  if (path === "/settings" && method === "GET") {
    return send(route, 200, { revision: fixture.revision, updatedAt: NOW, settings: fixture.settings });
  }

  if (path === "/settings" && method === "PUT") {
    fixture.settingsWrites.push(body);
    const conflict = fixture.conflictNextWrite || body?.expectedRevision !== fixture.revision;
    fixture.conflictNextWrite = false;
    if (conflict) {
      return send(route, 409, {
        error: "Die Konfiguration wurde zwischenzeitlich geändert. Bitte neu laden.",
        code: "conflict",
      });
    }
    fixture.settings = applySettingsWrite(fixture.settings, body);
    fixture.revision += 1;
    return send(route, 200, { revision: fixture.revision, updatedAt: NOW, settings: fixture.settings });
  }

  if (path === "/connection-tests" && method === "POST") {
    const id = body?.id ?? null;
    fixture.testCalls.push({ revision: body?.revision, kind: body?.kind, id });
    return send(route, 200, connectionTestResult(body?.kind, id));
  }

  if (path === "/conversations" && method === "GET") {
    return send(route, 200, {
      conversations: [...fixture.conversations.values()],
      limit: 20,
      hasMore: fixture.historyHasMore,
    });
  }

  const viewMatch = /^\/conversations\/([^/]+)$/.exec(path);
  if (viewMatch && method === "GET") {
    return send(route, 200, conversationView(fixture, decodeURIComponent(viewMatch[1])));
  }

  if (path === "/runs" && method === "POST") {
    fixture.enqueues.push({
      conversationId: body?.conversationId,
      question: body?.question,
      idempotencyKey: body?.idempotencyKey,
    });
    if (fixture.failNextEnqueue) {
      fixture.failNextEnqueue = false;
      return send(route, 503, { error: "Fixtureserver ist vorübergehend nicht erreichbar." });
    }
    return send(route, 201, { run: fixture.startRun(body.conversationId, body.question, body.conversationTitle) });
  }

  const eventsMatch = /^\/runs\/([^/]+)\/events$/.exec(path);
  if (eventsMatch && method === "GET") {
    const afterSequence = Number(url.searchParams.get("afterSequence") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const fresh = (fixture.events.get(eventsMatch[1]) ?? []).filter((event) => event.sequence > afterSequence);
    return send(route, 200, { events: fresh.slice(0, limit), afterSequence, limit, hasMore: fresh.length > limit });
  }

  const stopMatch = /^\/runs\/([^/]+)\/stop$/.exec(path);
  if (stopMatch && method === "POST") {
    const run = fixture.runs.get(stopMatch[1]);
    fixture.stopCount += 1;
    run.state = "cancelled";
    run.cancelRequested = true;
    run.finishedAt = NOW;
    run.result = null; // A stopped run discards the unfinished draft.
    fixture.activeRun.delete(run.conversationId);
    return send(route, 200, { run });
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(path);
  if (runMatch && method === "GET") {
    return send(route, 200, { run: fixture.runs.get(runMatch[1]) });
  }

  return send(route, 404, { error: `Unhandled fixture route ${method} ${path}` });
}

// --------------------------------------------------------------------------
// Scenario driver
// --------------------------------------------------------------------------

const fixture = createFixture();
const checks = [];

function assert(condition, name, detail = "") {
  if (!condition) {
    throw new Error(`${name}${detail ? ` — ${detail}` : ""}`);
  }
  checks.push(name);
  console.log(`  ✓ ${name}`);
}

async function openDetails(page, label) {
  const summary = page.locator("summary", { hasText: label }).first();
  if (!(await summary.locator("xpath=..").evaluate((element) => element.open))) {
    await summary.click();
  }
}

async function assertNoOverflow(page, name) {
  const report = await page.evaluate(() => {
    const panel = document.querySelector(
      'section[aria-labelledby="findog-agent-chat-title"], section[aria-labelledby="findog-agent-settings-title"]',
    );
    const root = document.getElementById("root");
    const rect = panel?.getBoundingClientRect() ?? { right: 0, left: 0 };
    let maxRight = rect.left;
    for (const element of panel?.querySelectorAll("*") ?? []) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 || box.height > 0) {
        maxRight = Math.max(maxRight, box.right);
      }
    }
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      root: root ? root.scrollWidth - root.clientWidth : 0,
      panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
      escape: Math.round(maxRight - rect.right),
    };
  });
  assert(report.doc <= 1 && report.root <= 1 && report.panel <= 1 && report.escape <= 1, name, JSON.stringify(report));
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  const { server, baseUrl } = await startFixtureServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const runtimeErrors = [];
  const expectedHttpStatuses = new Set();
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    const status = /status of (\d+)/.exec(text);
    // Chromium logs every non-2xx fetch; the fixture provokes 503/409/403 on purpose.
    if (text.startsWith("Failed to load resource") && status) {
      expectedHttpStatuses.add(status[1]);
      return;
    }
    runtimeErrors.push(`console: ${text}`);
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/api/admin/findog-agent/**", (route) => handleApi(route, fixture));

  try {
    console.log("\n[1] Chat: mounting, history and citations (desktop 1440)");
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#findog-agent-chat-title").waitFor();
    assert(
      await page.locator(".admin-desktop-navigation button", { hasText: "Findog Agent" }).count() === 1
        && await page.locator(".admin-desktop-navigation button", { hasText: "Agent-Einstellungen" }).count() === 1,
      "admin navigation exposes both Findog Agent entries",
    );
    assert(
      await page.locator(".admin-workspace-heading h1").innerText() === "Findog Agent",
      "admin host renders the selected area heading",
    );
    await page.getByText("Wie hoch ist die Steuer?").first().waitFor();
    assert(await page.getByText("Der Satz beträgt 10 Prozent").first().isVisible(), "seeded conversation renders its answer");
    assert(
      await page.getByText("Merkblatt Steuer").first().isVisible(),
      "completed answer sources are recovered from the associated run",
    );

    await page.getByRole("button", { name: "Quelle src_1 anzeigen" }).click();
    await page.getByRole("heading", { name: "Beleg src_1" }).waitFor();
    assert(await page.locator("pre").innerText() === SOURCE.text, "citation click shows the stored evidence excerpt");
    assert(await page.locator(`a[href="${SOURCE.url}"]`).isVisible(), "source panel links the stored original URL only");
    assert(
      await page.getByText("knowledgeBaseId").first().isVisible() && await page.getByText("chunk-7").first().isVisible(),
      "source panel shows real provenance fields",
    );
    await page.getByRole("button", { name: "Beleg schließen" }).click();

    console.log("\n[2] Chat: new conversation, idempotent retry and native keyboard send");
    await openDetails(page, "Verlauf");
    assert(
      await page.getByText(/nur die letzten 20 Unterhaltungen geladen/).isVisible(),
      "truncated history is reported instead of claimed complete",
    );
    await page.getByRole("button", { name: "Neue Unterhaltung" }).click();
    await page.getByText("Noch keine Frage in dieser Unterhaltung").waitFor();

    await page.locator("#findog-agent-question").click();
    await page.keyboard.type(QUESTION);
    assert(await page.locator("#findog-agent-question").inputValue() === QUESTION, "typing works through real keyboard input");

    fixture.failNextEnqueue = true;
    await page.locator('form button[type="submit"]').focus();
    await page.keyboard.press("Enter");
    await page.getByRole("alert").first().waitFor();
    assert(
      await page.locator("#findog-agent-question").inputValue() === QUESTION,
      "failed submit keeps the question in the composer",
    );
    assert(fixture.enqueues.length === 1, "failed submit posted exactly one enqueue request");

    await page.locator('form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("#findog-agent-question")?.value === "");
    assert(fixture.enqueues.length === 2, "retry posted a second enqueue request");
    assert(
      fixture.enqueues[0].idempotencyKey === fixture.enqueues[1].idempotencyKey,
      "retry reuses the stable idempotency key",
    );

    console.log("\n[3] Chat: live activity, overflow and reconnect");
    await page.getByText("Wissensdatenbank durchsuchen").first().waitFor();
    await page.getByText("Recherche läuft").first().waitFor();
    assert(
      await page.getByText("Beleg prüfen und antworten").first().isVisible(),
      "high-level plan steps are rendered while running",
    );
    await assertNoOverflow(page, "desktop chat has no horizontal overflow");
    await page.screenshot({ path: join(evidenceDirectory, "chat-desktop-running.png") });

    const enqueuesBeforeReload = fixture.enqueues.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#findog-agent-chat-title").waitFor();
    await page.locator("p", { hasText: QUESTION }).first().waitFor();
    await page.waitForFunction(() => document.body.innerText.includes("Recherche läuft"));
    assert(
      fixture.enqueues.length === enqueuesBeforeReload,
      "reload reconnects to the active run without posting another question",
    );

    console.log("\n[4] Chat: explicit Stop");
    await page.getByRole("button", { name: "Stopp", exact: true }).click();
    await page.getByText("Abgebrochen").first().waitFor();
    assert(fixture.stopCount === 1, "Stop issued exactly one cancellation request");
    assert(await page.locator("p", { hasText: QUESTION }).first().isVisible(), "cancelled run retains the user question");
    assert(
      await page.getByText("Antwort", { exact: true }).count() === 0,
      "cancelled run discards the unfinished draft",
    );
    assert(
      await page.getByText(/nur die letzten 50 Nachrichten dieser Unterhaltung/).isVisible(),
      "truncated message window is reported",
    );

    console.log("\n[5] Settings: load, save and revision conflict");
    await page.locator(".admin-desktop-navigation button", { hasText: "Agent-Einstellungen" }).click();
    await page.locator("#findog-agent-settings-title").waitFor();
    await page.getByText("Revision 4").waitFor();
    assert(
      await page.locator("#findog-agent-name").inputValue() === "Findog Agent (Preview)",
      "settings render real grouped values instead of raw JSON",
    );

    await page.locator("#findog-agent-name").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Findog Agent Test");
    await page.locator('button:has-text("Speichern")').first().click();
    await page.getByText("als Revision 5 gespeichert").waitFor();
    assert(fixture.revision === 5 && fixture.settingsWrites.at(-1).expectedRevision === 4, "save sends the expected revision");
    assert(fixture.testCalls.length === 0, "saving never triggers model tests or external discovery");

    fixture.conflictNextWrite = true;
    await page.locator("#findog-agent-name").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Findog Agent Test!");
    await page.locator('button:has-text("Speichern")').first().click();
    await page.getByText(/zwischenzeitlich geändert/).waitFor();
    assert(
      await page.locator("#findog-agent-name").inputValue() === "Findog Agent Test!",
      "revision conflict keeps the user's edits and shows a useful error",
    );
    assert(fixture.revision === 5, "rejected conflict does not advance the server revision");

    console.log("\n[6] Settings: WeKnora, Exa, MCP discovery and model testing");
    await openDetails(page, "Wissensdatenbank");
    await page.getByRole("button", { name: "Wissensbasen laden" }).click();
    await page.getByText("Handbuch").waitFor();
    assert(
      fixture.testCalls.at(-1).kind === "weknora" && fixture.testCalls.at(-1).revision === 5,
      "knowledge discovery uses the saved revision",
    );
    const knowledgeCheckbox = page.getByRole("checkbox", { name: "Handbuch" });
    await knowledgeCheckbox.focus();
    await page.keyboard.press("Space");
    assert(await knowledgeCheckbox.isChecked(), "knowledge base allowlist toggles by native keyboard");

    await openDetails(page, "Modelle");
    await page.getByRole("button", { name: "Modell testen" }).click();
    await page.getByText("Erfolgreich: Das Modell hat geantwortet.").waitFor();
    assert(
      fixture.testCalls.at(-1).kind === "model" && fixture.testCalls.at(-1).id === "model-1",
      "model test targets the saved catalog entry",
    );
    assert(
      await page.getByText(/kann Token verbrauchen/).first().isVisible(),
      "model testing warns that it may consume paid tokens",
    );

    await openDetails(page, "MCP-Werkzeuge");
    await page.getByRole("button", { name: "Werkzeuge laden" }).click();
    await page.getByText("search_documents").waitFor();
    assert(
      fixture.testCalls.at(-1).kind === "mcp" && fixture.testCalls.at(-1).id === "mcp-1",
      "MCP discovery uses the saved revision",
    );
    const toolCheckbox = page.getByRole("checkbox", { name: "search_documents" });
    await toolCheckbox.check();
    assert(await toolCheckbox.isChecked(), "MCP tools require explicit allowlist approval");
    assert(
      await page.getByText("vom Server als schreibgeschützt gekennzeichnet").first().isVisible(),
      "MCP read-only annotations are shown as hints, not authorization",
    );

    await page.locator('button:has-text("Speichern")').first().click();
    await page.getByText("als Revision 6 gespeichert").waitFor();
    assert(
      fixture.settings.knowledge.knowledgeBaseIds.includes("kb-1")
        && fixture.settings.mcp.servers[0].allowedTools.includes("search_documents"),
      "checkbox selections map to persisted backend semantics",
    );
    assert(fixture.testCalls.every((call) => call.revision === 5), "tests always send an explicitly saved revision");
    await assertNoOverflow(page, "desktop settings have no horizontal overflow");
    await page.screenshot({ path: join(evidenceDirectory, "settings-desktop.png") });

    console.log("\n[7] Mobile 390 px: settings and chat stay readable");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#findog-agent-name").waitFor();
    await page.waitForTimeout(200);
    await assertNoOverflow(page, "mobile settings have no horizontal overflow");
    await page.screenshot({ path: join(evidenceDirectory, "settings-mobile.png") });

    await page.locator(".admin-mobile-navigation summary").click();
    await page.locator(".admin-mobile-navigation button", { hasText: "Findog Agent" }).click();
    await page.locator("#findog-agent-chat-title").waitFor();
    await page.waitForTimeout(200);
    assert(
      await page.locator(".admin-mobile-navigation").isVisible() && await page.locator("#findog-agent-question").isVisible(),
      "mobile admin navigation and composer remain usable at 390 px",
    );
    await assertNoOverflow(page, "mobile chat has no horizontal overflow");
    await page.screenshot({ path: join(evidenceDirectory, "chat-mobile.png") });

    console.log("\n[8] Revoked admin session clears feature state");
    fixture.denyNext = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Administrationsberechtigung für den Findog Agent wurde entzogen/).waitFor();
    assert(
      await page.locator('section[aria-labelledby="findog-agent-chat-title"] button').count() === 0,
      "denied session leaks no conversation or control state",
    );

    assert(runtimeErrors.length === 0, "no browser runtime errors", runtimeErrors.join(" | "));
    assert(
      ["403", "409", "503"].every((status) => expectedHttpStatuses.has(status)),
      "fixture provoked the denied, conflict and retry paths",
      [...expectedHttpStatuses].join(", "),
    );
    console.log(`\nAll ${checks.length} browser checks passed. Screenshots in ${evidenceDirectory}`);
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nFAILED after ${checks.length} checks: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
