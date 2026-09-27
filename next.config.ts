import type { NextConfig } from "next";

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

// src/proxy.ts runs for every request, so Next.js buffers each request body for it and
// silently cuts it off after this limit (default 10 MB) before the route handler reads it.
// Match the 100 MiB the reverse proxy must accept, which covers a full Scanning batch,
// Fred attachments and 20 MiB download uploads including multipart overhead.
const MAX_PROXIED_REQUEST_BODY_BYTES = 100 * 1_024 * 1_024;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: MAX_PROXIED_REQUEST_BODY_BYTES,
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
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
