import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekThinkingTranslator,
  createThinkingCollector,
  sanitizeThinkingText,
  THINKING_TRANSLATION_SYSTEM_PROMPT,
  type ThinkingTranslator,
} from "./thinking-trace";

const UUID = "99ada6f9-5075-445c-b071-ccc7718f4b02";

describe("sanitizeThinkingText", () => {
  it("removes weknora:// URIs and UUIDs", () => {
    const text = sanitizeThinkingText(`Read weknora://doc/${UUID} and also ${UUID.toUpperCase()} (see weknora://kb/${UUID}).`, "en");
    expect(text).not.toMatch(/weknora/iu);
    expect(text).not.toContain(UUID);
    expect(text).not.toContain(UUID.toUpperCase());
    expect(text).not.toContain("[ID]");
    expect(text).toBe("Read and also (see).");
  });

  it("turns chunk references into Fundstelle(n)", () => {
    expect(sanitizeThinkingText("Look at chunk 32 first.", "en")).toBe("Look at Fundstelle first.");
    expect(sanitizeThinkingText("chunks 3, 5 and 7 agree; more chunks follow", "en")).toBe("Fundstellen agree; more Fundstellen follow");
    expect(sanitizeThinkingText("The chunk is relevant", "en")).toBe("The Fundstelle is relevant");
  });

  it("strips tool and function identifiers", () => {
    const en = sanitizeThinkingText("I will call knowledge_search with a query, then list_knowledge_chunks({ id: 1 }) and todo_write.", "en");
    expect(en).not.toMatch(/knowledge_search|list_knowledge_chunks|todo_write/u);
    expect(en).toContain("a tool");
    const de = sanitizeThinkingText("Ich rufe knowledge_search auf.", "de");
    expect(de).toBe("Ich rufe ein Werkzeug auf.");
  });

  it("masks hosts, model names and paths via the shared maskers", () => {
    const text = sanitizeThinkingText("Using gpt-4o on app:8080 and /var/lib/weknora/data/file.md", "en");
    expect(text).not.toMatch(/gpt-4o|app:8080|\/var\/lib/u);
  });

  it("keeps legal citations, amounts and dates untouched", () => {
    const text = "§ 33 Abs. 4 Z 1 EStG, LStR Rz 785, 1.234,56 € am 31.12.2025 und Art. 5/2";
    expect(sanitizeThinkingText(text, "de")).toBe(text);
  });

  it("is idempotent and tolerant of non-strings", () => {
    const dirty = `Look at chunk 4 in weknora://doc/${UUID} via knowledge_search at gpt-4o`;
    const once = sanitizeThinkingText(dirty, "en");
    expect(sanitizeThinkingText(once, "en")).toBe(once);
    expect(sanitizeThinkingText(undefined)).toBe("");
    expect(sanitizeThinkingText(42)).toBe("");
  });
});

function thinkingEvent(id: string, content: string, done = false) {
  return { id, response_type: "thinking", content, done, data: {} };
}

function makeCollector(translate: ThinkingTranslator, extra: Partial<Parameters<typeof createThinkingCollector>[0]> = {}) {
  return createThinkingCollector({ translate, ...extra });
}

describe("createThinkingCollector", () => {
  it("accumulates chunks per block id and finalizes on done", async () => {
    const translate = vi.fn<ThinkingTranslator>().mockImplementation(async (text) => `DE: ${text}`);
    const collector = makeCollector(translate);
    collector.ingest(thinkingEvent("a", "The user asks "));
    collector.ingest(thinkingEvent("b", "Second block"));
    collector.ingest(thinkingEvent("a", "about commuting."));
    expect(translate).not.toHaveBeenCalled();
    collector.ingest(thinkingEvent("a", "", true));
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith("The user asks about commuting.", expect.any(AbortSignal));

    const steps = await collector.settle();
    // block "b" is finalized by settle
    expect(steps.map((step) => step.detail)).toEqual([
      "DE: The user asks about commuting.",
      "DE: Second block",
    ]);
    expect(steps[0]).toMatchObject({ kind: "thinking", status: "completed", label: "Gedankengang" });
    expect(steps[0].id).not.toBe(steps[1].id);
  });

  it("finalizes an open block when a non-thinking event arrives and anchors it on the current step", async () => {
    let current: string | undefined = "analysis:phase";
    const translate = vi.fn<ThinkingTranslator>().mockResolvedValue("Übersetzt.");
    const collector = makeCollector(translate, { currentStepId: () => current });
    collector.ingest(thinkingEvent("a", "Plan the search"));
    collector.ingest({ response_type: "tool_call", data: { tool_name: "knowledge_search" } });
    current = "knowledge:1";
    expect(translate).toHaveBeenCalledTimes(1);
    const steps = await collector.settle();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ afterId: "analysis:phase", detail: "Übersetzt." });
  });

  it("reads id and content from nested data and ignores unrelated events", async () => {
    const translate = vi.fn<ThinkingTranslator>().mockImplementation(async (text) => `DE ${text}`);
    const collector = makeCollector(translate);
    collector.ingest({ response_type: "thinking", data: { event_id: "t1", content: "nested " } });
    collector.ingest({ response_type: "thinking", data: { event_id: "t1", content: "text", done: true } });
    collector.ingest(null);
    collector.ingest("garbage");
    collector.ingest({ response_type: "answer", content: "answer text" });
    const steps = await collector.settle();
    expect(steps.map((step) => step.detail)).toEqual(["DE nested text"]);
  });

  it("sanitizes before translating and again after translating", async () => {
    const translate = vi.fn<ThinkingTranslator>().mockImplementation(async (text) => {
      expect(text).not.toMatch(/weknora|knowledge_search/u);
      expect(text).toContain("Fundstelle");
      return `Ich nutze knowledge_search für weknora://doc/${UUID} in Chunk 3`;
    });
    const collector = makeCollector(translate);
    collector.ingest(thinkingEvent("a", `Use knowledge_search on weknora://doc/${UUID}, chunk 32.`, true));
    const [step] = await collector.settle();
    expect(step.detail).not.toMatch(/weknora|knowledge_search|99ada6f9/u);
    expect(step.detail).toContain("ein Werkzeug");
  });

  it("bounds block size (6.000 chars) and block count (20)", async () => {
    const translate = vi.fn<ThinkingTranslator>().mockResolvedValue("ok");
    const collector = makeCollector(translate);
    collector.ingest(thinkingEvent("big", "x".repeat(5_000)));
    collector.ingest(thinkingEvent("big", "y".repeat(5_000)));
    collector.ingest(thinkingEvent("big", "z", true));
    expect(translate.mock.calls[0][0]).toHaveLength(6_000);
    for (let index = 0; index < 40; index += 1) collector.ingest(thinkingEvent(`b${index}`, "text", true));
    expect(translate).toHaveBeenCalledTimes(20);
    expect(await collector.settle()).toHaveLength(20);
  });

  it("drops a block silently when translation fails, returns nothing or times out", async () => {
    const failures: ThinkingTranslator[] = [
      async () => { throw new Error("boom"); },
      async () => null,
      async () => "   ",
    ];
    for (const translate of failures) {
      const collector = makeCollector(translate);
      collector.ingest(thinkingEvent("a", "English reasoning", true));
      expect(await collector.settle()).toEqual([]);
    }

    vi.useFakeTimers();
    try {
      const hanging: ThinkingTranslator = (_text, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      const collector = makeCollector(hanging, { timeoutMs: 20_000 });
      collector.ingest(thinkingEvent("a", "English reasoning", true));
      const settled = collector.settle(30_000);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await settled).toEqual([]);
      expect(collector.drain()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits longer than the grace period for slow translations", async () => {
    vi.useFakeTimers();
    try {
      const slow: ThinkingTranslator = () => new Promise((resolve) => setTimeout(() => resolve("zu spät"), 10_000));
      const collector = makeCollector(slow);
      collector.ingest(thinkingEvent("a", "English reasoning", true));
      const settled = collector.settle(500);
      await vi.advanceTimersByTimeAsync(501);
      expect(await settled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drain returns ready steps without blocking, reset discards in-flight work", async () => {
    let release: (value: string) => void = () => undefined;
    const translate: ThinkingTranslator = () => new Promise((resolve) => { release = resolve; });
    const collector = makeCollector(translate);
    collector.ingest(thinkingEvent("a", "English reasoning", true));
    expect(collector.drain()).toEqual([]);
    collector.reset();
    release("Deutsch");
    await Promise.resolve();
    await Promise.resolve();
    expect(collector.drain()).toEqual([]);
    expect(await collector.settle(10)).toEqual([]);
  });
});

describe("createDeepSeekThinkingTranslator", () => {
  it("posts a low-temperature translation request and returns the content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Hallo" } }],
    }), { status: 200 }));
    const translate = createDeepSeekThinkingTranslator({ fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "sk-test" });
    expect(await translate("Hello", new AbortController().signal)).toBe("Hallo");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBeLessThanOrEqual(0.2);
    expect(body.messages).toEqual([
      { role: "system", content: THINKING_TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: "Hello" },
    ]);
  });

  it("returns null on HTTP errors, network errors and missing keys", async () => {
    const signal = new AbortController().signal;
    const http = createDeepSeekThinkingTranslator({
      fetchImpl: vi.fn().mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch,
      apiKey: "sk-test",
    });
    expect(await http("Hello", signal)).toBeNull();
    const network = createDeepSeekThinkingTranslator({
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch,
      apiKey: "sk-test",
    });
    expect(await network("Hello", signal)).toBeNull();
    const previous = { a: process.env.DEEPSEEK_API_KEY, b: process.env.GLOBAL_DEEPSEEK_API_KEY };
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GLOBAL_DEEPSEEK_API_KEY;
    try {
      const noKey = createDeepSeekThinkingTranslator({ fetchImpl: vi.fn() as unknown as typeof fetch });
      expect(await noKey("Hello", signal)).toBeNull();
    } finally {
      if (previous.a !== undefined) process.env.DEEPSEEK_API_KEY = previous.a;
      if (previous.b !== undefined) process.env.GLOBAL_DEEPSEEK_API_KEY = previous.b;
    }
  });
});
