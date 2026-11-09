import type { NextConfig } from "next";

// Relative import: next.config.ts is loaded outside the "@/" alias; this module has no imports.
import { MAX_SCANNING_MULTIPART_BYTES } from "./src/lib/scanning/config";

const supabaseConnectSources = [
  "https://*.supabase.co",
  "wss://*.supabase.co",
  "http://localhost:54321",
  "ws://localhost:54321",
  "http://127.0.0.1:54321",
  "ws://127.0.0.1:54321",
];

const configuredSupabaseOrigin = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
})();

if (configuredSupabaseOrigin && !supabaseConnectSources.includes(configuredSupabaseOrigin)) {
  supabaseConnectSources.push(configuredSupabaseOrigin);
}

if (configuredSupabaseOrigin?.startsWith("https://")) {
  const configuredSupabaseWebSocketOrigin = configuredSupabaseOrigin.replace("https://", "wss://");
  if (!supabaseConnectSources.includes(configuredSupabaseWebSocketOrigin)) {
    supabaseConnectSources.push(configuredSupabaseWebSocketOrigin);
  }
}

const supabaseImageSources = supabaseConnectSources.filter((source) => (
  source.startsWith("https://") || source.startsWith("http://")
));
const developmentScriptSources = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

// Next's proxy buffers request bodies up to proxyClientMaxBodySize (default 10 MB)
// and silently truncates larger ones before the route sees them. The proxy runs
// on every route (maintenance mode), so this must cover the largest legitimate
// route limit: scanning multipart (5x5 MiB images + 5x10 MiB PDFs + 1 MiB =
// 76 MiB), above Fred native attachments (35 MiB + 64 KiB + 1 MiB) and admin
// downloads (20 MiB). Routes still enforce their own, smaller limits.
// next.config.test.ts checks the other limits stay below this value.
const PROXY_CLIENT_MAX_BODY_BYTES = MAX_SCANNING_MULTIPART_BYTES + 4 * 1_024 * 1_024;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: PROXY_CLIENT_MAX_BODY_BYTES,
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // Fredrun 2.0: große, selten geänderte Sprite-/Prop-Dateien dürfen lange gecacht werden.
        source: "/fredrun2/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; script-src 'self' 'unsafe-inline'${developmentScriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${supabaseImageSources.join(" ")}; connect-src 'self' ${supabaseConnectSources.join(" ")}; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
          },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
