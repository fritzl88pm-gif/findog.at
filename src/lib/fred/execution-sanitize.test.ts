import { describe, expect, it } from "vitest";

import {
  maskAbsolutePaths,
  maskEnvironmentDumps,
  maskInternalHosts,
  maskModelNames,
  maskUuids,
  sanitizeDisplayLine,
  stripSourceReferenceIds,
} from "./execution-sanitize";

describe("execution masking", () => {
  it("masks UUIDs and long hex ids but not regular numbers", () => {
    expect(maskUuids("kb 6f9619ff-8b86-d011-b42d-00c04fc964ff und 2026-07-12")).toBe("kb [ID] und 2026-07-12");
    expect(maskUuids(`hash ${"ab".repeat(20)}`)).toBe("hash [ID]");
  });

  it("masks internal hosts, domains and IPs", () => {
    expect(maskInternalHosts("app:8080 mcp:8000/path fred.sslip.io 192.168.1.5:5432 db.internal")).toBe("[intern] [intern]/path [intern] [intern] [intern]");
    expect(maskInternalHosts("Version 1.2.3.400 bleibt")).toBe("Version 1.2.3.400 bleibt");
  });

  it("masks model and provider names, keeps sentence punctuation", () => {
    expect(maskModelNames("Modell gpt-4o. Und claude-3-5-sonnet, text-embedding-3-large via OpenAI")).toBe("Modell [Modell]. Und [Modell], [Modell] via [Modell]");
    expect(maskModelNames("Gemeinde Gemini-Platz und gemini-2.5-pro")).toBe("Gemeinde Gemini-Platz und [Modell]");
  });

  it("shrinks absolute paths outside the working directory to their basename", () => {
    expect(maskAbsolutePaths("cat /etc/passwd && ls /var/lib/x/y.txt")).toBe("cat passwd && ls y.txt");
    expect(maskAbsolutePaths("python /workspace/out/a.py")).toBe("python ./out/a.py");
    expect(maskAbsolutePaths("https://ris.bka.gv.at/a/b und 12/05/2024 und und/oder")).toBe("https://ris.bka.gv.at/a/b und 12/05/2024 und und/oder");
  });

  it("collapses environment dumps and masks secret-looking single lines", () => {
    expect(maskEnvironmentDumps("A_B=1\nC_D=2\nE_F=3\nfertig")).toBe("[Umgebungsvariablen ausgeblendet]\nfertig");
    expect(maskEnvironmentDumps("API_TOKEN=abc\nMODE=fast")).toBe("API_TOKEN=[REDACTED]\nMODE=fast");
  });

  it("sanitizeDisplayLine is idempotent and bounded", () => {
    const once = sanitizeDisplayLine(`x ${"y ".repeat(300)} app:8080`, 50)!;
    expect(once.length).toBeLessThanOrEqual(51);
    expect(sanitizeDisplayLine(once, 50)).toBe(once);
    expect(sanitizeDisplayLine("   ", 10)).toBeUndefined();
  });

  it("strips knowledge-base and chunk ids from source references", () => {
    expect(stripSourceReferenceIds([
      { kind: "knowledge", doc: "A", chunkId: "c", knowledgeBaseId: "k" },
      { kind: "web", url: "https://x.at" },
    ])).toEqual([{ kind: "knowledge", doc: "A" }, { kind: "web", url: "https://x.at" }]);
  });
});
