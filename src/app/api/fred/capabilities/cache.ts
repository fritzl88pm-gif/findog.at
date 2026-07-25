import {
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readQuickFredEmbedServerConfig,
  type FredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  fetchFredUpstreamConfig,
  type FredUpstreamConfig,
} from "@/lib/weknora/fred-native";

const CAPABILITIES_FRESH_TTL_MS = 60_000;
const CAPABILITIES_STALE_WINDOW_MS = 600_000;
const CAPABILITIES_REFRESH_TIMEOUT_MS = 20_000;

type DerivedFredCapabilities = {
  webSearch: boolean;
  quickFred: boolean;
};

type CachedFredCapabilities = {
  value: DerivedFredCapabilities;
  freshUntil: number;
  staleUntil: number;
};

let cachedCapabilities: CachedFredCapabilities | null = null;
let capabilitiesRefresh: Promise<DerivedFredCapabilities> | null = null;

async function probeFredCapabilities(options: {
  config: FredEmbedServerConfig;
  signal: AbortSignal;
}): Promise<FredUpstreamConfig> {
  const session = await mintFredEmbedSession({
    config: options.config,
    signal: options.signal,
  });
  return fetchFredUpstreamConfig({
    session,
    config: options.config,
    signal: options.signal,
  });
}

async function probeQuickFredCapabilities(options: {
  fredChannelId: string;
  signal: AbortSignal;
}): Promise<{
  config: FredEmbedServerConfig & { expectedAgentId: string };
  upstreamConfig: FredUpstreamConfig;
} | null> {
  try {
    const config = readQuickFredEmbedServerConfig();
    if (config.channelId === options.fredChannelId) return null;
    const session = await mintFredEmbedSession({ config, signal: options.signal });
    const upstreamConfig = await fetchFredUpstreamConfig({
      session,
      config,
      signal: options.signal,
    });
    return { config, upstreamConfig };
  } catch {
    return null;
  }
}

async function refreshDerivedFredCapabilities(): Promise<DerivedFredCapabilities> {
  const signal = AbortSignal.timeout(CAPABILITIES_REFRESH_TIMEOUT_MS);
  const fredConfig = readFredEmbedServerConfig();
  const [fredUpstreamConfig, quickFredProbe] = await Promise.all([
    probeFredCapabilities({ config: fredConfig, signal }),
    probeQuickFredCapabilities({
      fredChannelId: fredConfig.channelId,
      signal,
    }),
  ]);
  const quickFred = Boolean(
    quickFredProbe
    && quickFredProbe.upstreamConfig.agentId === quickFredProbe.config.expectedAgentId
    && quickFredProbe.upstreamConfig.agentId !== fredUpstreamConfig.agentId
    && quickFredProbe.upstreamConfig.allowWebSearch === fredUpstreamConfig.allowWebSearch,
  );
  return {
    webSearch: fredUpstreamConfig.allowWebSearch,
    quickFred,
  };
}

export async function getDerivedFredCapabilities(): Promise<DerivedFredCapabilities> {
  const now = Date.now();
  if (cachedCapabilities && now < cachedCapabilities.freshUntil) {
    return cachedCapabilities.value;
  }
  if (!capabilitiesRefresh) {
    const pendingRefresh = refreshDerivedFredCapabilities()
      .then((value) => {
        const refreshedAt = Date.now();
        cachedCapabilities = {
          value,
          freshUntil: refreshedAt + CAPABILITIES_FRESH_TTL_MS,
          staleUntil: refreshedAt + CAPABILITIES_STALE_WINDOW_MS,
        };
        return value;
      })
      .finally(() => {
        if (capabilitiesRefresh === pendingRefresh) capabilitiesRefresh = null;
      });
    capabilitiesRefresh = pendingRefresh;
  }
  try {
    return await capabilitiesRefresh;
  } catch (error) {
    if (cachedCapabilities && Date.now() < cachedCapabilities.staleUntil) {
      return cachedCapabilities.value;
    }
    throw error;
  }
}

export function resetFredCapabilitiesCacheForTests(): void {
  cachedCapabilities = null;
  capabilitiesRefresh = null;
}
