import { FredEmbedSessionRejectedError } from "../errors";
import {
  mintFredEmbedSession,
  type FredEmbedServerConfig,
  type FredEmbedSession,
} from "./fred-embed";
import { fetchFredUpstreamConfig, type FredUpstreamConfig } from "./fred-native";

// WeKnora issues ems_ session tokens for 30 minutes and lets every embed call
// reuse them. A cached token is only handed out while at least this much of
// its lifetime remains, so it outlives the longest turn (12-minute deadline)
// including that turn's best-effort stop call.
const MIN_SESSION_REMAINING_MS = 15 * 60 * 1_000;
// The channel config only changes when the channel or its agent is edited.
const CONFIG_TTL_MS = 60_000;
const CONFIG_FETCH_TIMEOUT_MS = 15_000;

type CacheOptions = {
  config: FredEmbedServerConfig;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type CachedSession = { session: FredEmbedSession; reusableUntil: number };
type CachedConfig = { value: FredUpstreamConfig; freshUntil: number };

const sessions = new Map<string, CachedSession>();
const sessionRefreshes = new Map<string, Promise<FredEmbedSession>>();
const configs = new Map<string, CachedConfig>();
const configRefreshes = new Map<string, Promise<FredUpstreamConfig>>();

function cacheKey(config: FredEmbedServerConfig): string {
  return `${config.channelId}\n${config.exchangeOrigin}\n${config.publishToken}`;
}

/**
 * Lets one caller stop waiting without aborting the work other callers share.
 * The shared promise always gets a handler, so its failure is never unhandled.
 */
function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Returns a reusable embed session for the channel and mints one when none is
 * cached or the cached one is too close to expiry. Concurrent callers share a
 * single exchange. `rejectedToken` drops a token WeKnora refused first.
 */
export function getFredEmbedSession(
  options: CacheOptions & { rejectedToken?: string },
): Promise<FredEmbedSession> {
  const key = cacheKey(options.config);
  const cached = sessions.get(key);
  if (cached && cached.session.token === options.rejectedToken) {
    sessions.delete(key);
  } else if (cached && Date.now() < cached.reusableUntil) {
    return Promise.resolve(cached.session);
  }
  let pending = sessionRefreshes.get(key);
  if (!pending) {
    const refresh = mintFredEmbedSession({ config: options.config, fetchImpl: options.fetchImpl })
      .then((session) => {
        sessions.set(key, {
          session,
          reusableUntil: Date.now() + session.expiresIn * 1_000 - MIN_SESSION_REMAINING_MS,
        });
        return session;
      })
      .finally(() => {
        if (sessionRefreshes.get(key) === refresh) sessionRefreshes.delete(key);
      });
    sessionRefreshes.set(key, refresh);
    pending = refresh;
  }
  return awaitWithSignal(pending, options.signal);
}

/**
 * Runs an embed call with the given or cached session. When WeKnora rejects
 * that session token, the call is retried once with a freshly minted session.
 */
export async function withFredEmbedSession<T>(
  options: CacheOptions & { session?: FredEmbedSession },
  call: (session: FredEmbedSession) => Promise<T>,
): Promise<T> {
  const session = options.session ?? await getFredEmbedSession(options);
  try {
    return await call(session);
  } catch (error) {
    if (!(error instanceof FredEmbedSessionRejectedError)) throw error;
    return call(await getFredEmbedSession({ ...options, rejectedToken: session.token }));
  }
}

/** Returns the channel's upstream config, cached for a minute and shared by concurrent callers. */
export function getFredUpstreamConfig(options: CacheOptions): Promise<FredUpstreamConfig> {
  const key = cacheKey(options.config);
  const cached = configs.get(key);
  if (cached && Date.now() < cached.freshUntil) return Promise.resolve(cached.value);
  let pending = configRefreshes.get(key);
  if (!pending) {
    const refresh = withFredEmbedSession(
      { config: options.config, fetchImpl: options.fetchImpl },
      (session) => fetchFredUpstreamConfig({
        session,
        config: options.config,
        signal: AbortSignal.timeout(CONFIG_FETCH_TIMEOUT_MS),
        fetchImpl: options.fetchImpl,
      }),
    )
      .then((value) => {
        configs.set(key, { value, freshUntil: Date.now() + CONFIG_TTL_MS });
        return value;
      })
      .finally(() => {
        if (configRefreshes.get(key) === refresh) configRefreshes.delete(key);
      });
    configRefreshes.set(key, refresh);
    pending = refresh;
  }
  return awaitWithSignal(pending, options.signal);
}

export function resetFredEmbedCachesForTests(): void {
  sessions.clear();
  sessionRefreshes.clear();
  configs.clear();
  configRefreshes.clear();
}
