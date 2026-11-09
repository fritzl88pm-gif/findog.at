import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FredEmbedSessionRejectedError, UserVisibleError } from "../errors";
import {
  FredEmbedUpstreamError,
  mintFredEmbedSession,
  type FredEmbedSession,
} from "./fred-embed";
import {
  getFredEmbedSession,
  getFredUpstreamConfig,
  resetFredEmbedCachesForTests,
  withFredEmbedSession,
} from "./fred-embed-cache";
import { fetchFredUpstreamConfig } from "./fred-native";

vi.mock("./fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("./fred-embed")>();
  return { ...original, mintFredEmbedSession: vi.fn() };
});
vi.mock("./fred-native", async (importOriginal) => {
  const original = await importOriginal<typeof import("./fred-native")>();
  return { ...original, fetchFredUpstreamConfig: vi.fn() };
});

const config = {
  channelId: "fred-channel",
  publishToken: "em_publish_token_fixture_123456",
  exchangeOrigin: "https://findog.at",
};
const quickFredConfig = {
  channelId: "quickfred-channel",
  publishToken: "em_quickfred_publish_fixture_123456",
  exchangeOrigin: "https://findog.at",
};
const upstreamConfig = {
  agentId: "agent-1",
  knowledgeBaseIds: ["kb-1"],
  allowWebSearch: false,
  allowFileUpload: true,
  allowImageUpload: true,
};

function embedSession(token: string, expiresIn = 1800): FredEmbedSession {
  return { token, expiresIn, channelId: config.channelId, embedOrigin: "https://taxdog.cloud" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFredEmbedCachesForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getFredEmbedSession", () => {
  it("reuses a session until less than 15 minutes of its lifetime remain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_first_token_fixture_1234567"))
      .mockResolvedValueOnce(embedSession("ems_second_token_fixture_123456"));

    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_first_token_fixture_1234567" });
    vi.setSystemTime(new Date("2026-10-18T10:14:59.999Z"));
    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_first_token_fixture_1234567" });
    vi.setSystemTime(new Date("2026-10-18T10:15:00.000Z"));
    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_second_token_fixture_123456" });
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("hands out the cached token at once inside the prefetch window and mints one replacement in the background", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    const replacement = deferred<FredEmbedSession>();
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_first_token_fixture_1234567"))
      .mockReturnValueOnce(replacement.promise);
    await getFredEmbedSession({ config });

    // 10 minutes in: 20 minutes of lifetime remain, so no prefetch yet.
    vi.setSystemTime(new Date("2026-10-18T10:09:59.999Z"));
    await getFredEmbedSession({ config });
    expect(mintFredEmbedSession).toHaveBeenCalledOnce();

    // 10:10 sharp: 20 minutes remain -> prefetch window starts, token is still returned immediately.
    vi.setSystemTime(new Date("2026-10-18T10:10:00.000Z"));
    const results = await Promise.all([getFredEmbedSession({ config }), getFredEmbedSession({ config })]);
    expect(results.map((session) => session.token)).toEqual([
      "ems_first_token_fixture_1234567",
      "ems_first_token_fixture_1234567",
    ]);
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);

    replacement.resolve(embedSession("ems_second_token_fixture_123456"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_second_token_fixture_123456" });
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("never hands out a token with less than 15 minutes left, even while a prefetch is still running", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    const replacement = deferred<FredEmbedSession>();
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_first_token_fixture_1234567"))
      .mockReturnValueOnce(replacement.promise);
    await getFredEmbedSession({ config });

    vi.setSystemTime(new Date("2026-10-18T10:14:59.999Z"));
    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_first_token_fixture_1234567" });

    // At exactly 15 minutes remaining the old token is off limits: the caller waits for the shared mint.
    vi.setSystemTime(new Date("2026-10-18T10:15:00.000Z"));
    const waiting = getFredEmbedSession({ config });
    replacement.resolve(embedSession("ems_second_token_fixture_123456"));
    await expect(waiting).resolves.toMatchObject({ token: "ems_second_token_fixture_123456" });
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("keeps the cached token when the background mint fails, without an unhandled rejection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_first_token_fixture_1234567"))
      .mockRejectedValueOnce(new FredEmbedUpstreamError("unavailable"))
      .mockResolvedValueOnce(embedSession("ems_second_token_fixture_123456"));
    await getFredEmbedSession({ config });

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      vi.setSystemTime(new Date("2026-10-18T10:12:00.000Z"));
      await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_first_token_fixture_1234567" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    // The next caller still gets the valid token and retries the prefetch.
    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_first_token_fixture_1234567" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(3);
  });

  it("drops a rejected token even inside the prefetch window and waits for a replacement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_first_token_fixture_1234567"))
      .mockResolvedValueOnce(embedSession("ems_second_token_fixture_123456"));
    await getFredEmbedSession({ config });

    vi.setSystemTime(new Date("2026-10-18T10:12:00.000Z"));
    await expect(getFredEmbedSession({ config, rejectedToken: "ems_first_token_fixture_1234567" }))
      .resolves.toMatchObject({ token: "ems_second_token_fixture_123456" });
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("never reuses a session issued for less than 15 minutes", async () => {
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_short_token_fixture_1234567", 600));

    await getFredEmbedSession({ config });
    await getFredEmbedSession({ config });

    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("keeps one session per channel", async () => {
    vi.mocked(mintFredEmbedSession).mockImplementation(async ({ config: channelConfig } = {}) => (
      embedSession(`ems_${channelConfig?.channelId}_token_fixture`)
    ));

    const [fred, quickFred] = await Promise.all([
      getFredEmbedSession({ config }),
      getFredEmbedSession({ config: quickFredConfig }),
    ]);

    expect(fred.token).toBe("ems_fred-channel_token_fixture");
    expect(quickFred.token).toBe("ems_quickfred-channel_token_fixture");
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("shares one exchange between concurrent callers and lets each caller stop waiting alone", async () => {
    const exchange = deferred<FredEmbedSession>();
    vi.mocked(mintFredEmbedSession).mockReturnValue(exchange.promise);
    const impatient = new AbortController();

    const first = getFredEmbedSession({ config, signal: impatient.signal });
    const second = getFredEmbedSession({ config });
    impatient.abort(new Error("caller gave up"));
    exchange.resolve(embedSession("ems_shared_token_fixture_1234567"));

    await expect(first).rejects.toThrow("caller gave up");
    await expect(second).resolves.toMatchObject({ token: "ems_shared_token_fixture_1234567" });
    expect(mintFredEmbedSession).toHaveBeenCalledOnce();
    expect(vi.mocked(mintFredEmbedSession).mock.calls[0][0]).not.toHaveProperty("signal");
  });

  it("handles a failed exchange whose only caller had already given up, and does not cache it", async () => {
    const exchange = deferred<FredEmbedSession>();
    vi.mocked(mintFredEmbedSession).mockReturnValueOnce(exchange.promise);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await expect(getFredEmbedSession({ config, signal: AbortSignal.abort(new Error("already gone")) }))
        .rejects.toThrow("already gone");
      exchange.reject(new FredEmbedUpstreamError("unavailable"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    vi.mocked(mintFredEmbedSession).mockResolvedValueOnce(embedSession("ems_retry_token_fixture_12345678"));
    await expect(getFredEmbedSession({ config })).resolves.toMatchObject({ token: "ems_retry_token_fixture_12345678" });
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("replaces a rejected token but keeps a replacement another caller already minted", async () => {
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_old_token_fixture_123456789"))
      .mockResolvedValueOnce(embedSession("ems_new_token_fixture_123456789"));

    await getFredEmbedSession({ config });
    await expect(getFredEmbedSession({ config, rejectedToken: "ems_old_token_fixture_123456789" }))
      .resolves.toMatchObject({ token: "ems_new_token_fixture_123456789" });
    await expect(getFredEmbedSession({ config, rejectedToken: "ems_old_token_fixture_123456789" }))
      .resolves.toMatchObject({ token: "ems_new_token_fixture_123456789" });
    expect(mintFredEmbedSession).toHaveBeenCalledTimes(2);
  });
});

describe("withFredEmbedSession", () => {
  it("retries a rejected call once with a freshly minted token", async () => {
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_fresh_token_fixture_12345678"));
    const call = vi.fn<(session: FredEmbedSession) => Promise<string>>()
      .mockRejectedValueOnce(new FredEmbedSessionRejectedError())
      .mockResolvedValueOnce("ok");

    await expect(withFredEmbedSession(
      { config, session: embedSession("ems_stale_token_fixture_12345678") },
      call,
    )).resolves.toBe("ok");
    expect(call.mock.calls.map(([session]) => session.token)).toEqual([
      "ems_stale_token_fixture_12345678",
      "ems_fresh_token_fixture_12345678",
    ]);
  });

  it("gives up after a second rejection and never retries other errors", async () => {
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_fresh_token_fixture_12345678"));
    const rejected = vi.fn<(session: FredEmbedSession) => Promise<string>>()
      .mockRejectedValue(new FredEmbedSessionRejectedError());
    const failing = vi.fn<(session: FredEmbedSession) => Promise<string>>()
      .mockRejectedValue(new UserVisibleError("Fred ist derzeit nicht erreichbar.", 502));

    await expect(withFredEmbedSession({ config }, rejected)).rejects.toBeInstanceOf(FredEmbedSessionRejectedError);
    await expect(withFredEmbedSession({ config }, failing)).rejects.toThrow("nicht erreichbar");
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(failing).toHaveBeenCalledOnce();
  });
});

describe("getFredUpstreamConfig", () => {
  it("serves the cached channel config for a minute and shares concurrent fetches", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_config_token_fixture_1234567"));
    const firstFetch = deferred<typeof upstreamConfig>();
    vi.mocked(fetchFredUpstreamConfig)
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce({ ...upstreamConfig, agentId: "agent-2" });

    const first = getFredUpstreamConfig({ config });
    const second = getFredUpstreamConfig({ config });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchFredUpstreamConfig).toHaveBeenCalledOnce();
    firstFetch.resolve(upstreamConfig);
    await expect(Promise.all([first, second])).resolves.toEqual([upstreamConfig, upstreamConfig]);

    vi.setSystemTime(new Date("2026-10-18T10:00:59.999Z"));
    await expect(getFredUpstreamConfig({ config })).resolves.toEqual(upstreamConfig);
    expect(fetchFredUpstreamConfig).toHaveBeenCalledOnce();

    // Past the TTL the stale value is still served at once; the refresh runs in the background.
    vi.setSystemTime(new Date("2026-10-18T10:01:00.000Z"));
    await expect(getFredUpstreamConfig({ config })).resolves.toEqual(upstreamConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getFredUpstreamConfig({ config })).resolves.toMatchObject({ agentId: "agent-2" });
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(2);
    expect(mintFredEmbedSession).toHaveBeenCalledOnce();
  });

  it("serves a stale config without waiting and runs exactly one shared background fetch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_config_token_fixture_1234567"));
    const refresh = deferred<typeof upstreamConfig>();
    vi.mocked(fetchFredUpstreamConfig)
      .mockResolvedValueOnce(upstreamConfig)
      .mockReturnValueOnce(refresh.promise);
    await getFredUpstreamConfig({ config });

    vi.setSystemTime(new Date("2026-10-18T10:05:00.000Z"));
    const results = await Promise.all([
      getFredUpstreamConfig({ config }),
      getFredUpstreamConfig({ config }),
      getFredUpstreamConfig({ config }),
    ]);
    expect(results).toEqual([upstreamConfig, upstreamConfig, upstreamConfig]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(2);

    refresh.resolve({ ...upstreamConfig, agentId: "agent-2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getFredUpstreamConfig({ config })).resolves.toMatchObject({ agentId: "agent-2" });
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(2);
  });

  it("waits for a fresh fetch once the cached config is older than ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_config_token_fixture_1234567"));
    const refresh = deferred<typeof upstreamConfig>();
    vi.mocked(fetchFredUpstreamConfig)
      .mockResolvedValueOnce(upstreamConfig)
      .mockReturnValueOnce(refresh.promise);
    await getFredUpstreamConfig({ config });

    vi.setSystemTime(new Date("2026-10-18T10:09:59.999Z"));
    await expect(getFredUpstreamConfig({ config })).resolves.toEqual(upstreamConfig);

    vi.setSystemTime(new Date("2026-10-18T10:10:00.000Z"));
    let settled = false;
    const blocking = getFredUpstreamConfig({ config }).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(2);

    refresh.resolve({ ...upstreamConfig, agentId: "agent-2" });
    await expect(blocking).resolves.toMatchObject({ agentId: "agent-2" });
  });

  it("keeps the stale config when the background refresh fails, without an unhandled rejection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_config_token_fixture_1234567"));
    vi.mocked(fetchFredUpstreamConfig)
      .mockResolvedValueOnce(upstreamConfig)
      .mockRejectedValueOnce(new UserVisibleError("Fred ist derzeit nicht erreichbar.", 502))
      .mockResolvedValueOnce({ ...upstreamConfig, agentId: "agent-2" });
    await getFredUpstreamConfig({ config });

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      vi.setSystemTime(new Date("2026-10-18T10:02:00.000Z"));
      await expect(getFredUpstreamConfig({ config })).resolves.toEqual(upstreamConfig);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    // The failure was not cached as success: the next call serves the stale value and retries.
    await expect(getFredUpstreamConfig({ config })).resolves.toEqual(upstreamConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getFredUpstreamConfig({ config })).resolves.toMatchObject({ agentId: "agent-2" });
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(3);
  });

  it("fetches with its own timeout instead of the caller's signal", async () => {
    vi.mocked(mintFredEmbedSession).mockResolvedValue(embedSession("ems_config_token_fixture_1234567"));
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue(upstreamConfig);
    const caller = new AbortController();

    await getFredUpstreamConfig({ config, signal: caller.signal });

    const fetchSignal = vi.mocked(fetchFredUpstreamConfig).mock.calls[0][0].signal;
    expect(fetchSignal).toBeInstanceOf(AbortSignal);
    expect(fetchSignal).not.toBe(caller.signal);
  });

  it("does not cache a failed fetch and replaces a token WeKnora rejects", async () => {
    vi.mocked(mintFredEmbedSession)
      .mockResolvedValueOnce(embedSession("ems_old_token_fixture_123456789"))
      .mockResolvedValueOnce(embedSession("ems_new_token_fixture_123456789"));
    vi.mocked(fetchFredUpstreamConfig)
      .mockRejectedValueOnce(new UserVisibleError("Fred ist derzeit nicht erreichbar.", 502))
      .mockRejectedValueOnce(new FredEmbedSessionRejectedError())
      .mockResolvedValueOnce(upstreamConfig);

    await expect(getFredUpstreamConfig({ config })).rejects.toThrow("nicht erreichbar");
    await expect(getFredUpstreamConfig({ config })).resolves.toEqual(upstreamConfig);
    expect(vi.mocked(fetchFredUpstreamConfig).mock.calls.map(([options]) => options.session.token)).toEqual([
      "ems_old_token_fixture_123456789",
      "ems_old_token_fixture_123456789",
      "ems_new_token_fixture_123456789",
    ]);
  });
});
