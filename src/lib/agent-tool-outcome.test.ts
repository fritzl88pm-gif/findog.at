import { describe, expect, it, vi } from "vitest";

import { createDeadline } from "./deadline";
import { UserVisibleError } from "./errors";
import { classifyToolFailure, executeToolWithOutcome } from "./agent-tool-outcome";

describe("agent tool outcomes", () => {
  it.each([
    [400, "invalid_arguments", false],
    [401, "authentication", false],
    [403, "authentication", false],
    [408, "timeout", true],
    [429, "rate_limit", true],
    [502, "transport", true],
    [503, "transport", true],
    [504, "timeout", true],
  ] as const)("classifies HTTP %i as %s", (status, kind, retryable) => {
    expect(classifyToolFailure(new UserVisibleError("Sichere Meldung", status))).toEqual({
      ok: false,
      kind,
      retryable,
      message: "Sichere Meldung",
      status,
      attempts: 1,
    });
  });

  it("classifies MCP soft errors and retains their safe message", () => {
    expect(classifyToolFailure("  Datenbankfehler: HTTP 503. Bitte später versuchen.")).toEqual({
      ok: false,
      kind: "transport",
      retryable: true,
      message: "Datenbankfehler: HTTP 503. Bitte später versuchen.",
      status: 503,
      attempts: 1,
    });

    expect(classifyToolFailure("Datenbankfehler: JSON-RPC-Antwort ist ungültig.")).toMatchObject({
      ok: false,
      kind: "protocol",
      retryable: false,
    });
  });

  it("does not expose arbitrary thrown error messages", () => {
    const outcome = classifyToolFailure(new TypeError("fetch failed for https://example.test?token=secret"));

    expect(outcome).toMatchObject({
      ok: false,
      kind: "transport",
      retryable: true,
      message: "Die Recherchefunktion ist derzeit nicht erreichbar.",
    });
    expect(outcome.message).not.toContain("secret");
  });

  it("treats an explicit status as authoritative over message wording", () => {
    expect(classifyToolFailure(new UserVisibleError("Aufruf wurde abgebrochen.", 504))).toMatchObject({
      ok: false,
      kind: "timeout",
      retryable: true,
      status: 504,
    });
  });

  it("classifies cancellation without retry", async () => {
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    const operation = vi.fn().mockRejectedValue(aborted);

    await expect(executeToolWithOutcome(operation)).resolves.toMatchObject({
      ok: false,
      kind: "cancelled",
      retryable: false,
      attempts: 1,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 502, 503, 504])("retries transient HTTP %i once", async (status) => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new UserVisibleError("Vorübergehend nicht verfügbar.", status))
      .mockResolvedValueOnce("Treffer");

    await expect(executeToolWithOutcome(operation)).resolves.toEqual({
      ok: true,
      value: "Treffer",
      attempts: 2,
    });
    expect(operation).toHaveBeenNthCalledWith(1, 1);
    expect(operation).toHaveBeenNthCalledWith(2, 2);
  });

  it("retries a statusless network transport failure once without exposing its message", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("fetch failed for https://example.test?token=secret"))
      .mockResolvedValueOnce("Treffer");

    await expect(executeToolWithOutcome(operation)).resolves.toEqual({
      ok: true,
      value: "Treffer",
      attempts: 2,
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries a statusless timeout once", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("socket timed out"))
      .mockResolvedValueOnce("Treffer");

    await expect(executeToolWithOutcome(operation)).resolves.toMatchObject({
      ok: true,
      value: "Treffer",
      attempts: 2,
    });
  });

  it("retries a transient soft error once and returns the second failure", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockResolvedValue("Datenbankfehler: HTTP 502.");

    await expect(executeToolWithOutcome(operation)).resolves.toMatchObject({
      ok: false,
      kind: "transport",
      retryable: true,
      status: 502,
      attempts: 2,
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403])("does not retry HTTP %i", async (status) => {
    const operation = vi.fn().mockRejectedValue(new UserVisibleError("Nicht wiederholen.", status));

    await expect(executeToolWithOutcome(operation)).resolves.toMatchObject({
      ok: false,
      retryable: false,
      status,
      attempts: 1,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry protocol failures", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("invalid JSON-RPC response"));

    await expect(executeToolWithOutcome(operation)).resolves.toMatchObject({
      ok: false,
      kind: "protocol",
      retryable: false,
      attempts: 1,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry after the shared deadline has been aborted", async () => {
    const parent = new AbortController();
    const deadline = createDeadline(10_000, { parentSignal: parent.signal });
    const operation = vi.fn().mockRejectedValue(new UserVisibleError("Vorübergehend nicht verfügbar.", 503));
    parent.abort();

    try {
      await expect(executeToolWithOutcome(operation, { deadline })).resolves.toMatchObject({
        ok: false,
        kind: "transport",
        attempts: 1,
      });
      expect(operation).toHaveBeenCalledTimes(1);
    } finally {
      deadline.dispose();
    }
  });

  it("does not retry when the deadline lacks the requested reserve", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deadline = createDeadline(100);
    const operation = vi.fn().mockRejectedValue(new UserVisibleError("Zeitüberschreitung.", 504));

    try {
      await expect(executeToolWithOutcome(operation, { deadline, reserveMs: 100 })).resolves.toMatchObject({
        ok: false,
        kind: "timeout",
        retryable: true,
        attempts: 1,
      });
      expect(operation).toHaveBeenCalledTimes(1);
    } finally {
      deadline.dispose();
      vi.useRealTimers();
    }
  });
});
