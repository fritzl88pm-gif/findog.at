import { describe, expect, it } from "vitest";

import {
  mergeFredResearchStep,
  parseWeKnoraResearchEvent,
  sanitizePublicSourceUrl,
  transformWeKnoraAnswer,
  type FredResearchStep,
} from "./fred-research";

describe("WeKnora research presentation", () => {
  it("removes complete and split citation tags while retaining their provenance", () => {
    const raw = 'Gemäß § 1 gilt das. <kb doc="LStR_2002.md" chunk_id="chunk-1" kb_id="kb-1" /> Danach.';

    expect(transformWeKnoraAnswer(raw)).toEqual({
      text: "Gemäß § 1 gilt das.  Danach.",
      sources: [{
        kind: "knowledge",
        doc: "LStR_2002.md",
        chunkId: "chunk-1",
        knowledgeBaseId: "kb-1",
      }],
    });
    expect(transformWeKnoraAnswer("Antwort <k", { streaming: true }).text).toBe("Antwort ");
    expect(transformWeKnoraAnswer('Antwort <kb doc="LStR', { streaming: true }).text).toBe("Antwort ");
  });

  it("removes web tags and only accepts safe web source URLs", () => {
    expect(transformWeKnoraAnswer(
      'Quelle <web url="https://ris.bka.gv.at/Dokument.wxe?id=1" title="RIS" />',
    )).toEqual({
      text: "Quelle ",
      sources: [{
        kind: "web",
        url: "https://ris.bka.gv.at/Dokument.wxe?id=1",
        title: "RIS",
      }],
    });
    expect(transformWeKnoraAnswer('<web url="javascript:alert(1)" title="X" />').sources).toEqual([]);
  });

  it("maps structured WeKnora tool events to German display text without exposing reasoning", () => {
    const update = parseWeKnoraResearchEvent({
      response_type: "tool_call",
      content: "Calling tool: knowledge_search with hidden arguments",
      data: {
        tool_call_id: "call-1",
        tool_name: "knowledge_search",
        arguments: { secret_query: "raw reasoning" },
      },
    });

    expect(update.step).toEqual({
      id: "call-1",
      kind: "knowledge",
      status: "running",
      label: "Wissensbasis wird durchsucht",
    });
    expect(JSON.stringify(update)).not.toContain("raw reasoning");
    expect(JSON.stringify(update)).not.toContain("Calling tool");
  });

  it("updates a running tool step with its result and does not treat tool failures as fatal", () => {
    const running = parseWeKnoraResearchEvent({
      response_type: "tool_call",
      data: { tool_call_id: "call-1", tool_name: "web_search" },
    }).step!;
    const completed = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "call-1",
        tool_name: "web_search",
        success: true,
        duration_ms: 1240,
      },
    });

    expect(mergeFredResearchStep([running], completed.step!)).toEqual([{
      id: "call-1",
      kind: "web",
      status: "completed",
      label: "Websuche durchgeführt",
      durationMs: 1240,
    }]);
    expect(parseWeKnoraResearchEvent({
      response_type: "error",
      data: { tool_call_id: "call-2", tool_name: "web_search" },
    })).toMatchObject({ fatalError: false, step: { status: "failed" } });
  });

  it("turns reference events into a source summary", () => {
    const update = parseWeKnoraResearchEvent({
      response_type: "references",
      data: {
        event_id: "refs-1",
        references: [{
          document_name: "EStG_1988.md",
          chunk_id: "chunk-2",
          kb_id: "kb-2",
        }],
      },
    });

    expect(update.step).toMatchObject({
      id: "refs-1",
      kind: "sources",
      status: "completed",
      label: "1 Quelle gefunden",
    });
    expect(update.sources).toEqual([{
      kind: "knowledge",
      doc: "EStG_1988.md",
      chunkId: "chunk-2",
      knowledgeBaseId: "kb-2",
    }]);
  });

  it("extracts safe source references from native direct result payloads in advanced mode (web_search, knowledge_search, grep_chunks, list_knowledge_chunks)", () => {
    // 1. web_search
    const webResult = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "web-direct-1",
        tool_name: "web_search",
        results: [
          { url: "https://www.bmf.gv.at/themen/steuern.html", title: "BMF Steuern", snippet: "Raw snippet not to be persisted" },
          { url: "http://ris.bka.gv.at/NormDokument.wxe?id=NOR123", title: "RIS EStG", raw_html: "<div>...</div>" },
          { url: "javascript:evil()", title: "Evil" },
        ],
        success: true,
      },
    }, { includeDirectSources: true });

    expect(webResult.sources).toEqual([
      { kind: "web", url: "https://www.bmf.gv.at/themen/steuern.html", title: "BMF Steuern" },
      { kind: "web", url: "http://ris.bka.gv.at/NormDokument.wxe?id=NOR123", title: "RIS EStG" },
    ]);
    expect(JSON.stringify(webResult.sources)).not.toContain("Raw snippet");
    expect(JSON.stringify(webResult.sources)).not.toContain("raw_html");

    // 2. knowledge_search / search_knowledge
    const kbResult = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "kb-direct-1",
        tool_name: "search_knowledge",
        knowledge_base_id: "kb-default-id",
        results: [
          {
            chunk_id: "chk-001",
            knowledge_id: "doc-001",
            knowledge_title: "EStG Richtlinien 2025",
            knowledge_base_id: "kb-austria",
            content: "Private chunk text",
          },
          {
            chunk_id: "chk-002",
            knowledge_id: "doc-002",
            faq_standard_question: "Wie hoch ist die Pendlerpauschale?",
            content: "Private FAQ content",
          },
        ],
        success: true,
      },
    }, { includeDirectSources: true });

    expect(kbResult.sources).toEqual([
      { kind: "knowledge", doc: "EStG Richtlinien 2025", chunkId: "chk-001", knowledgeBaseId: "kb-austria" },
      { kind: "knowledge", doc: "Wie hoch ist die Pendlerpauschale?", chunkId: "chk-002", knowledgeBaseId: "kb-default-id" },
    ]);
    expect(JSON.stringify(kbResult.sources)).not.toContain("Private chunk text");
    expect(JSON.stringify(kbResult.sources)).not.toContain("Private FAQ content");

    // 3. grep_chunks (chunk_results and knowledge_results)
    const grepResult = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "grep-direct-1",
        tool_name: "grep_chunks",
        chunk_results: [
          {
            knowledge_id: "k-100",
            title: "UStG Kommentar",
            knowledge_base_id: "kb-tax",
            chunks: [{ chunk_id: "c-10", content: "some text" }],
          },
        ],
        knowledge_results: [
          {
            knowledge_id: "k-200",
            faq_question: "FAQ Kleinunternehmerregelung",
            knowledge_base_id: "kb-tax",
            match_snippet: "snippet",
          },
        ],
        success: true,
      },
    }, { includeDirectSources: true });

    expect(grepResult.sources).toEqual([
      { kind: "knowledge", doc: "UStG Kommentar", chunkId: "c-10", knowledgeBaseId: "kb-tax" },
      { kind: "knowledge", doc: "FAQ Kleinunternehmerregelung", knowledgeBaseId: "kb-tax" },
    ]);
    expect(JSON.stringify(grepResult.sources)).not.toContain("some text");
    expect(JSON.stringify(grepResult.sources)).not.toContain("snippet");

    // 4. list_knowledge_chunks
    const listResult = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "list-direct-1",
        tool_name: "list_knowledge_chunks",
        knowledge_id: "doc-manual",
        knowledge_title: "Handbuch zur Körperschaftsteuer",
        knowledge_base_id: "kb-corp",
        chunks: [
          { chunk_id: "chunk-a", content: "raw chunk" },
          { chunk_id: "chunk-b", title: "Kapitel 2", content: "raw chunk 2" },
        ],
        success: true,
      },
    }, { includeDirectSources: true });

    expect(listResult.sources).toEqual([
      { kind: "knowledge", doc: "Handbuch zur Körperschaftsteuer", chunkId: "chunk-a", knowledgeBaseId: "kb-corp" },
      { kind: "knowledge", doc: "Kapitel 2", chunkId: "chunk-b", knowledgeBaseId: "kb-corp" },
    ]);
    expect(JSON.stringify(listResult.sources)).not.toContain("raw chunk");
  });

  it("merges consecutive thinking research steps without creating duplicate cards", () => {
    const think1 = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Erster Schritt",
      done: false,
      data: { event_id: "think-1" },
    });

    const think2 = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Erster Schritt fertig",
      done: true,
      data: { event_id: "think-2" },
    });

    let steps = mergeFredResearchStep([], think1.step!);
    expect(steps).toHaveLength(1);

    steps = mergeFredResearchStep(steps, think2.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].label).toBe("Anfrage analysiert");
  });

  it("handles adjacent analysis merge lifecycle: completed -> running -> completed and failed -> running -> completed", () => {
    const think1Running = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Start",
      done: false,
      data: { event_id: "think-1" },
    });
    const think1Done = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Fertig",
      done: true,
      data: { event_id: "think-1" },
    });

    let steps = mergeFredResearchStep([], think1Running.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");

    steps = mergeFredResearchStep(steps, think1Done.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].label).toBe("Anfrage analysiert");

    // Second distinct analysis step immediately following completed first step
    const think2Running = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Zweiter Schritt läuft",
      done: false,
      data: { event_id: "think-2" },
    });
    steps = mergeFredResearchStep(steps, think2Running.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");
    expect(steps[0].label).toBe("Anfrage wird analysiert");

    // Second analysis step completes
    const think2Done = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Zweiter Schritt fertig",
      done: true,
      data: { event_id: "think-2" },
    });
    steps = mergeFredResearchStep(steps, think2Done.step!);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("completed");
    expect(steps[0].label).toBe("Anfrage analysiert");

    // Intervening non-analysis step prevents merge
    const interveningTool = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "web-search-1",
        tool_name: "web_search",
        success: true,
      },
    });
    steps = mergeFredResearchStep(steps, interveningTool.step!);
    expect(steps).toHaveLength(2);
    expect(steps[1].kind).toBe("web");

    const think3Running = parseWeKnoraResearchEvent({
      response_type: "thinking",
      content: "Dritter Schritt nach Tool",
      done: false,
      data: { event_id: "think-3" },
    });
    steps = mergeFredResearchStep(steps, think3Running.step!);
    expect(steps).toHaveLength(3);
    expect(steps[0].kind).toBe("analysis");
    expect(steps[1].kind).toBe("web");
    expect(steps[2].kind).toBe("analysis");
    expect(steps[2].status).toBe("running");

    // Failed analysis followed by new running analysis
    const thinkFailed: FredResearchStep = {
      id: "analysis:fail",
      kind: "analysis",
      status: "failed",
      label: "Anfrage fehlgeschlagen",
    };
    let failedSteps = mergeFredResearchStep([], thinkFailed);
    expect(failedSteps[0].status).toBe("failed");

    const thinkRecovering: FredResearchStep = {
      id: "analysis:recover",
      kind: "analysis",
      status: "running",
      label: "Anfrage wird erneut analysiert",
    };
    failedSteps = mergeFredResearchStep(failedSteps, thinkRecovering);
    expect(failedSteps).toHaveLength(1);
    expect(failedSteps[0].status).toBe("running");
    expect(failedSteps[0].label).toBe("Anfrage wird erneut analysiert");
  });

  it("security regression: only known native retrieval tools project direct results, chunk_results, knowledge_results, and chunks", () => {
    // 1. Unknown/arbitrary tool returning data.results with URL/title must produce NO source references
    const arbitraryWeb = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "arbitrary-1",
        tool_name: "arbitrary_custom_plugin",
        results: [
          { url: "https://evil.example.com/payload", title: "Malicious Injection" },
        ],
        success: true,
      },
    });
    expect(arbitraryWeb.sources).toEqual([]);

    // 2. Unknown/arbitrary tool returning data.results with document fields must produce NO source references
    const arbitraryKb = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "arbitrary-2",
        tool_name: "bash_executor",
        results: [
          { doc: "Confidential Strategy 2026", chunk_id: "secret-1" },
        ],
        success: true,
      },
    });
    expect(arbitraryKb.sources).toEqual([]);

    // 3. Unknown tool returning chunk_results, knowledge_results, chunks must produce NO source references
    const arbitraryChunks = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "arbitrary-3",
        tool_name: "unknown_retriever",
        chunk_results: [{ title: "Fake Doc", chunks: [{ chunk_id: "c1" }] }],
        knowledge_results: [{ faq_question: "Fake FAQ" }],
        chunks: [{ chunk_id: "c2", content: "data" }],
        success: true,
      },
    });
    expect(arbitraryChunks.sources).toEqual([]);

    // 4. Unknown tool with explicit references/sources envelope STILL extracts safely
    const arbitraryWithEnvelope = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "arbitrary-4",
        tool_name: "custom_mcp_tool",
        references: [
          { url: "https://legit.example.com", title: "Legitimate Source" },
        ],
        results: [
          { url: "https://untrusted.example.com", title: "Untrusted Result" },
        ],
        success: true,
      },
    });
    expect(arbitraryWithEnvelope.sources).toEqual([
      { kind: "web", url: "https://legit.example.com/", title: "Legitimate Source" },
    ]);

    // 5. Allowed native retrieval tools project direct results properly in advanced mode
    const webFetchResult = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "fetch-1",
        tool_name: "web_fetch",
        results: [
          { url: "https://www.bmf.gv.at/doc.pdf", title: "BMF Dok" },
        ],
        success: true,
      },
    }, { includeDirectSources: true });
    expect(webFetchResult.sources).toEqual([
      { kind: "web", url: "https://www.bmf.gv.at/doc.pdf", title: "BMF Dok" },
    ]);

    const wikiDocResult = parseWeKnoraResearchEvent({
      response_type: "tool_result",
      data: {
        tool_call_id: "wiki-1",
        tool_name: "wiki_read_source_doc",
        results: [
          { doc: "Wiki Reference Doc", chunk_id: "w-1", knowledge_base_id: "kb-wiki" },
        ],
        success: true,
      },
    }, { includeDirectSources: true });
    expect(wikiDocResult.sources).toEqual([
      { kind: "knowledge", doc: "Wiki Reference Doc", chunkId: "w-1", knowledgeBaseId: "kb-wiki" },
    ]);
  });

  describe("Gating direct-result sources to Advanced only", () => {
    const webEvent = {
      response_type: "tool_result",
      data: {
        tool_call_id: "web-1",
        tool_name: "web_search",
        results: [{ url: "https://www.bmf.gv.at/steuern", title: "BMF Steuern" }],
        success: true,
      },
    };

    const kbEvent = {
      response_type: "tool_result",
      data: {
        tool_call_id: "kb-1",
        tool_name: "knowledge_search",
        results: [{ knowledge_title: "EStG 2025", chunk_id: "chk-1", knowledge_base_id: "kb-1" }],
        success: true,
      },
    };

    const envelopeEvent = {
      response_type: "tool_result",
      data: {
        tool_call_id: "env-1",
        tool_name: "custom_tool",
        references: [{ url: "https://www.bmf.gv.at/info", title: "BMF Info" }],
        success: true,
      },
    };

    const referencesEvent = {
      response_type: "references",
      data: {
        event_id: "refs-1",
        references: [{ document_name: "UStG.md", chunk_id: "chk-ustg", kb_id: "kb-ustg" }],
      },
    };

    it("yields sourceReferences for direct retrieval results when includeDirectSources is true", () => {
      const webAdvanced = parseWeKnoraResearchEvent(webEvent, { includeDirectSources: true });
      expect(webAdvanced.sources).toEqual([
        { kind: "web", url: "https://www.bmf.gv.at/steuern", title: "BMF Steuern" },
      ]);

      const kbAdvanced = parseWeKnoraResearchEvent(kbEvent, { includeDirectSources: true });
      expect(kbAdvanced.sources).toEqual([
        { kind: "knowledge", doc: "EStG 2025", chunkId: "chk-1", knowledgeBaseId: "kb-1" },
      ]);
    });

    it("yields NO direct-result sourceReferences in simple/default mode", () => {
      const webDefault = parseWeKnoraResearchEvent(webEvent);
      expect(webDefault.sources).toEqual([]);

      const webSimple = parseWeKnoraResearchEvent(webEvent, { includeDirectSources: false });
      expect(webSimple.sources).toEqual([]);

      const kbDefault = parseWeKnoraResearchEvent(kbEvent);
      expect(kbDefault.sources).toEqual([]);

      const kbSimple = parseWeKnoraResearchEvent(kbEvent, { includeDirectSources: false });
      expect(kbSimple.sources).toEqual([]);
    });

    it("keeps explicit references/sources available in simple and default modes (Finding 3)", () => {
      const envDefault = parseWeKnoraResearchEvent(envelopeEvent);
      expect(envDefault.sources).toEqual([
        { kind: "web", url: "https://www.bmf.gv.at/info", title: "BMF Info" },
      ]);

      const envSimple = parseWeKnoraResearchEvent(envelopeEvent, { includeDirectSources: false });
      expect(envSimple.sources).toEqual([
        { kind: "web", url: "https://www.bmf.gv.at/info", title: "BMF Info" },
      ]);

      const refsDefault = parseWeKnoraResearchEvent(referencesEvent);
      expect(refsDefault.sources).toEqual([
        { kind: "knowledge", doc: "UStG.md", chunkId: "chk-ustg", knowledgeBaseId: "kb-ustg" },
      ]);

      const refsSimple = parseWeKnoraResearchEvent(referencesEvent, { includeDirectSources: false });
      expect(refsSimple.sources).toEqual([
        { kind: "knowledge", doc: "UStG.md", chunkId: "chk-ustg", knowledgeBaseId: "kb-ustg" },
      ]);

      // Top-level event.references is parsed in simple/default mode
      const eventRefsPayload = {
        response_type: "custom_event",
        event_id: "evt-refs-1",
        references: [{ doc: "KStG.md", chunk_id: "chk-kstg", kb_id: "kb-kstg" }],
      };
      expect(parseWeKnoraResearchEvent(eventRefsPayload).sources).toEqual([
        { kind: "knowledge", doc: "KStG.md", chunkId: "chk-kstg", knowledgeBaseId: "kb-kstg" },
      ]);

      // Regression: Top-level event.sources must NOT be parsed in generic/simple/default handling
      const eventSourcesPayload = {
        response_type: "custom_event",
        event_id: "evt-sources-1",
        sources: [{ doc: "LeakedTopLevel.md", chunk_id: "chk-leak", kb_id: "kb-leak" }],
      };
      expect(parseWeKnoraResearchEvent(eventSourcesPayload).sources).toEqual([]);
      expect(parseWeKnoraResearchEvent(eventSourcesPayload, { includeDirectSources: false }).sources).toEqual([]);
    });

    it("makes parser options fail closed with includeDirectSources (Finding 5)", () => {
      // Direct sources only when includeDirectSources === true
      expect(parseWeKnoraResearchEvent(webEvent, { includeDirectSources: true }).sources).toEqual([
        { kind: "web", url: "https://www.bmf.gv.at/steuern", title: "BMF Steuern" },
      ]);
      expect(parseWeKnoraResearchEvent(kbEvent, { includeDirectSources: true }).sources).toEqual([
        { kind: "knowledge", doc: "EStG 2025", chunkId: "chk-1", knowledgeBaseId: "kb-1" },
      ]);

      // Explicit includeDirectSources: false wins even if other properties are passed
      expect(parseWeKnoraResearchEvent(webEvent, { includeDirectSources: false, researchDisplayMode: "advanced" } as never).sources).toEqual([]);
      expect(parseWeKnoraResearchEvent(kbEvent, { includeDirectSources: false, researchDisplayMode: "advanced" } as never).sources).toEqual([]);

      // Omitting includeDirectSources defaults to false (fail closed)
      expect(parseWeKnoraResearchEvent(webEvent, {}).sources).toEqual([]);
      expect(parseWeKnoraResearchEvent(webEvent, { researchDisplayMode: "advanced" } as never).sources).toEqual([]);
      expect(parseWeKnoraResearchEvent(webEvent).sources).toEqual([]);
    });
  });

  describe("Safe public source projection", () => {
    it("rejects malicious, internal, and private URLs", () => {
      const maliciousUrls = [
        // Non-http(s)
        "javascript:alert(1)",
        "data:text/html,evil",
        "file:///etc/passwd",
        "ftp://ftp.example.com",
        // Userinfo
        "https://user:password@example.com/page",
        "http://admin@example.com/",
        // Localhost & internal hostnames
        "http://localhost",
        "http://localhost:8080/admin",
        "http://api.localhost/test",
        "http://service.local/data",
        "http://db.internal/query",
        "http://intranet.lan/page",
        "http://portal.corp/secret",
        "http://nas.home/share",
        "http://intranet.intra/auth",
        "http://internal-router/config",
        // IPv4 loopback, private, link-local, broadcast
        "http://127.0.0.1/api",
        "http://127.0.0.2:8000/test",
        "http://10.0.0.1/secret",
        "http://192.168.1.1/admin",
        "http://172.16.0.1/data",
        "http://172.31.255.255/info",
        "http://169.254.169.254/latest/meta-data",
        "http://100.64.0.1/cgnat",
        "http://0.0.0.0/listen",
        "http://255.255.255.255/bcast",
        // IPv6 loopback, link-local, ULA, IPv4-mapped
        "http://[::1]/secret",
        "http://[0:0:0:0:0:0:0:1]/api",
        "http://[fe80::1]/linklocal",
        "http://[fc00::1]/ula",
        "http://[fd12:3456:789a::1]/ula2",
        "http://[::ffff:127.0.0.1]/mapped",
        "http://[::ffff:10.0.0.1]/mapped-private",
        "http://[::ffff:7f00:1]/mapped-hex",
        "http://[0:0:0:0:0:ffff:a00:1]/mapped-expanded",
      ];

      for (const url of maliciousUrls) {
        const update = parseWeKnoraResearchEvent({
          response_type: "tool_result",
          data: {
            tool_name: "web_search",
            results: [{ url, title: "Test Title" }],
          },
        }, { includeDirectSources: true });
        expect(update.sources).toEqual([]);
      }
    });

    it("rejects hostnames with DNS root-label trailing dots (Finding 1)", () => {
      const trailingDotUrls = [
        "http://localhost.",
        "http://localhost.:8080/admin",
        "http://api.localhost./test",
        "http://nas.",
        "http://metadata.google.internal.",
        "http://service.local.",
        "http://db.internal.",
        "http://intranet.lan.",
        "http://portal.corp.",
        "http://nas.home.",
        "http://intranet.intra.",
        "http://127.0.0.1.",
        "http://10.0.0.1.",
        "http://192.168.1.1.",
      ];

      for (const url of trailingDotUrls) {
        expect(sanitizePublicSourceUrl(url)).toBeNull();
        const update = parseWeKnoraResearchEvent({
          response_type: "tool_result",
          data: {
            tool_name: "web_search",
            results: [{ url, title: "Trailing Dot Test" }],
          },
        }, { includeDirectSources: true });
        expect(update.sources).toEqual([]);
      }
    });

    it("rejects IPv4-compatible IPv6 addresses decoding to private/local IPv4 (Finding 2)", () => {
      const ipv4CompatiblePrivateUrls = [
        "http://[::a00:1]/secret",
        "http://[::a00:1]:8080/test",
        "http://[0:0:0:0:0:0:a00:1]/expanded",
        "http://[0000:0000:0000:0000:0000:0000:0a00:0001]/full-expanded",
        "http://[::7f00:1]/loopback",
        "http://[0:0:0:0:0:0:7f00:1]/expanded-loopback",
        "http://[::c0a8:101]/lan",
        "http://[::a9fe:a9fe]/metadata",
        "http://[::ac10:1]/private-172",
        "http://[::10.0.0.1]/dot-compat",
        "http://[0:0:0:0:0:0:10.0.0.1]/dot-compat-expanded",
        "http://[::127.0.0.1]/dot-compat-loopback",
        "http://[::192.168.1.1]/dot-compat-lan",
      ];

      for (const url of ipv4CompatiblePrivateUrls) {
        expect(sanitizePublicSourceUrl(url)).toBeNull();
        const update = parseWeKnoraResearchEvent({
          response_type: "tool_result",
          data: {
            tool_name: "web_search",
            results: [{ url, title: "IPv6 Compat Test" }],
          },
        }, { includeDirectSources: true });
        expect(update.sources).toEqual([]);
      }
    });

    it("rejects URLs with sensitive query parameter names and hardened variations (Finding 4)", () => {
      const sensitiveQueries = [
        // Exact names
        "https://example.com/api?token=secret123",
        "https://example.com/api?ACCESS_TOKEN=abc456",
        "https://example.com/?auth=jwt_or_cookie",
        "https://example.com/?authorization=bearer_xyz",
        "https://example.com/?api_key=key_12345",
        "https://example.com/?apikey=key_67890",
        "https://example.com/?Key=masterkey",
        "https://example.com/?secret=topsecret",
        "https://example.com/?password=mypassword",
        "https://example.com/?passwd=pwd123",
        "https://example.com/?credential=cred_token",
        "https://example.com/?signature=sig_abc",
        "https://example.com/?sig=sig_short",
        "https://example.com/?jwt=eyJhbGciOi...",
        // Finding 4 specific bypasses and normalized variations
        "https://example.com/oauth?client_secret=sec999",
        "https://example.com/oauth?refresh_token=rt123",
        "https://example.com/oauth?id_token=idt123",
        "https://example.com/auth?session_token=st123",
        "https://example.com/api?access-token=at123",
        "https://example.com/api?token[]=array_token",
        "https://example.com/api?token[0]=array_indexed_token",
        "https://example.com/s3?X-Amz-Signature=amzsig123",
        "https://example.com/s3?X-Amz-Credential=amzcred123",
        "https://example.com/s3?X-Amz-Security-Token=amzsec123",
        // CamelCase, nested bracket, and plural forms from consolidation
        "https://example.com/api?accessToken=at123",
        "https://example.com/api?refreshToken=rt123",
        "https://example.com/api?clientSecret=cs123",
        "https://example.com/api?auth[token]=nested_tok",
        "https://example.com/api?auth[user][token]=nested_tok_user",
        "https://example.com/api?credentials=my_creds",
        "https://example.com/api?apiKey=ak123",
        // Normalized parameter names ending in sensitive suffixes
        "https://example.com/api?my_custom_token=val",
        "https://example.com/api?my-custom-token=val",
        "https://example.com/api?oauth_secret=val",
        "https://example.com/api?hmac_signature=val",
        "https://example.com/api?cloud_credential=val",
        "https://example.com/api?admin_password=val",
        "https://example.com/api?user_passwd=val",
        "https://example.com/api?access_key=val",
        "https://example.com/api?access-key[]=val",
      ];

      for (const url of sensitiveQueries) {
        expect(sanitizePublicSourceUrl(url)).toBeNull();
        const update = parseWeKnoraResearchEvent({
          response_type: "tool_result",
          data: {
            tool_name: "web_search",
            results: [{ url, title: "Query Test" }],
          },
        }, { includeDirectSources: true });
        expect(update.sources).toEqual([]);
      }
    });

    it("allows benign query parameters such as monkey, tokenizer, signature_version, page, query", () => {
      const benignUrls = [
        "https://example.com/search?page=1",
        "https://example.com/search?query=austria+tax",
        "https://example.com/zoo?monkey=true",
        "https://example.com/nlp?tokenizer=bpe",
        "https://example.com/s3?signature_version=4",
        "https://example.com/s3?sig_version=4",
        "https://example.com/api?author=max",
        "https://example.com/api?keyword=steuer",
      ];

      for (const url of benignUrls) {
        expect(sanitizePublicSourceUrl(url)).toBe(url);
        const update = parseWeKnoraResearchEvent({
          response_type: "tool_result",
          data: {
            tool_name: "web_search",
            results: [{ url, title: "Benign Test" }],
          },
        }, { includeDirectSources: true });
        expect(update.sources).toEqual([{ kind: "web", url, title: "Benign Test" }]);
      }
    });

    it("strips URL fragments and accepts safe public URLs", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "tool_result",
        data: {
          tool_name: "web_search",
          results: [
            {
              url: "https://findok.bmf.gv.at/findok/link?nummer=RV/7100001/2020#heading-1",
              title: "Findok BMF Entscheidung",
            },
            {
              url: "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40232467#absatz-2",
              title: "RIS Bundesrecht",
            },
          ],
        },
      }, { includeDirectSources: true });

      expect(update.sources).toEqual([
        {
          kind: "web",
          url: "https://findok.bmf.gv.at/findok/link?nummer=RV/7100001/2020",
          title: "Findok BMF Entscheidung",
        },
        {
          kind: "web",
          url: "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40232467",
          title: "RIS Bundesrecht",
        },
      ]);
    });

    it("sanitizes/redacts and control-normalizes titles and document labels", () => {
      const update = parseWeKnoraResearchEvent({
        response_type: "tool_result",
        data: {
          tool_name: "search_knowledge",
          results: [
            {
              knowledge_title: "EStG \x00\x08Dokument mit Secret sk-live_12345678901234567890\r\nZweite Zeile",
              chunk_id: "chk-sec-1",
              knowledge_base_id: "kb-public",
            },
            {
              knowledge_title: "Internes Token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 und password='xyz'",
              chunk_id: "chk-sec-2",
              knowledge_base_id: "kb-public",
            },
          ],
        },
      }, { includeDirectSources: true });

      expect(update.sources).toHaveLength(2);
      expect(update.sources[0]).toMatchObject({
        kind: "knowledge",
        doc: expect.not.stringContaining("\x00"),
        chunkId: "chk-sec-1",
        knowledgeBaseId: "kb-public",
      });
      expect(JSON.stringify(update.sources)).not.toContain("sk-live_");
      expect(JSON.stringify(update.sources)).not.toContain("ghp_");
      expect(JSON.stringify(update.sources)).not.toContain("password='xyz'");
    });
  });

  describe("Exact native WeKnora v0.7.2 ID shapes", () => {
    it("extracts knowledgeBaseId from knowledge_base in list_knowledge_chunks payload", () => {
      // From upstream/internal/agent/tools/list_knowledge_chunks.go lines 214-279
      const listPayload = {
        response_type: "tool_result",
        data: {
          tool_call_id: "list-v072",
          tool_name: "list_knowledge_chunks",
          display_type: "knowledge_chunks_list",
          knowledge_id: "know-123",
          knowledge_title: "Handbuch v0.7.2",
          total_chunks: 10,
          fetched_chunks: 2,
          chunks: [
            {
              seq: 1,
              chunk_id: "chunk-072-1",
              chunk_index: 0,
              content: "Chunk 1 Content",
              chunk_type: "text",
              knowledge_id: "know-123",
              knowledge_base: "kb-v072-target",
            },
            {
              seq: 2,
              chunk_id: "chunk-072-2",
              chunk_index: 1,
              content: "Chunk 2 Content",
              chunk_type: "text",
              knowledge_id: "know-123",
              knowledge_base: "kb-v072-target",
            },
          ],
        },
      };

      const result = parseWeKnoraResearchEvent(listPayload, { includeDirectSources: true });
      expect(result.sources).toEqual([
        {
          kind: "knowledge",
          doc: "Handbuch v0.7.2",
          chunkId: "chunk-072-1",
          knowledgeBaseId: "kb-v072-target",
        },
        {
          kind: "knowledge",
          doc: "Handbuch v0.7.2",
          chunkId: "chunk-072-2",
          knowledgeBaseId: "kb-v072-target",
        },
      ]);
    });

    it("extracts chunkId from faq_id in FAQ search results", () => {
      // From upstream/internal/agent/tools/knowledge_search.go lines 1281, 1376
      const faqPayload = {
        response_type: "tool_result",
        data: {
          tool_call_id: "search-faq-1",
          tool_name: "knowledge_search",
          display_type: "search_results",
          results: [
            {
              result_index: 1,
              faq_id: "faq-chunk-999",
              index: 0,
              knowledge_id: "know-faq-doc",
              knowledge_base_id: "kb-faq-base",
              knowledge_title: "FAQ Steuern",
              faq_standard_question: "Wie wird die Pendlerpauschale berechnet?",
            },
          ],
        },
      };

      const result = parseWeKnoraResearchEvent(faqPayload, { includeDirectSources: true });
      expect(result.sources).toEqual([
        {
          kind: "knowledge",
          doc: "Wie wird die Pendlerpauschale berechnet?",
          chunkId: "faq-chunk-999",
          knowledgeBaseId: "kb-faq-base",
        },
      ]);
    });

    it("accepts first valid ID from knowledge_base_ids array when no singular ID exists", () => {
      // From upstream/internal/agent/tools/knowledge_search.go line 1410
      const searchWithArrayKb = {
        response_type: "tool_result",
        data: {
          tool_call_id: "search-kb-arr",
          tool_name: "knowledge_search",
          display_type: "search_results",
          knowledge_base_ids: ["kb-first-valid", "kb-second"],
          results: [
            {
              result_index: 1,
              chunk_id: "chk-arr-1",
              knowledge_id: "know-arr",
              knowledge_title: "Dokument im Multi-KB-Search",
            },
          ],
        },
      };

      const result = parseWeKnoraResearchEvent(searchWithArrayKb, { includeDirectSources: true });
      expect(result.sources).toEqual([
        {
          kind: "knowledge",
          doc: "Dokument im Multi-KB-Search",
          chunkId: "chk-arr-1",
          knowledgeBaseId: "kb-first-valid",
        },
      ]);
    });
  });
});
