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

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
              `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${supabaseImageSources.join(" ")}; connect-src 'self' ${supabaseConnectSources.join(" ")}; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
          },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
