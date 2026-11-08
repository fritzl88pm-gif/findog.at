#!/usr/bin/env node
// Compares the WeKnora config of Fred and Fred-Fallback, ignoring model_id.
// Usage: WEKNORA_API_KEY=… WEKNORA_FRED_FALLBACK_AGENT_ID=… node scripts/check-fred-fallback-drift.mjs
// Exit 0: identical, 1: drift, 2: setup/fetch error. Values of sensitive keys are never printed.

const apiUrl = (process.env.WEKNORA_API_URL || "https://taxdog.cloud/api/v1").replace(/\/+$/u, "");
const apiKey = process.env.WEKNORA_API_KEY || "";
const fredId = process.env.FRED_AGENT_ID || "e8b65a4d-dc41-4281-ba62-e01e50b0947a";
const fallbackId = process.env.WEKNORA_FRED_FALLBACK_AGENT_ID || "";
const IGNORED_KEYS = new Set(["model_id"]);
const SENSITIVE = /key|token|secret/iu;

if (!apiKey || !fallbackId) {
  console.error("WEKNORA_API_KEY and WEKNORA_FRED_FALLBACK_AGENT_ID are required.");
  process.exit(2);
}

async function agentConfig(id) {
  const response = await fetch(`${apiUrl}/agents/${encodeURIComponent(id)}`, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`GET /agents/${id} failed with HTTP ${response.status}`);
  const body = await response.json();
  const config = (body?.data ?? body)?.config;
  if (!config || typeof config !== "object") throw new Error(`Agent ${id} has no config object`);
  return config;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function show(value) {
  const text = canonical(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

try {
  const [fred, fallback] = await Promise.all([agentConfig(fredId), agentConfig(fallbackId)]);
  const keys = [...new Set([...Object.keys(fred), ...Object.keys(fallback)])]
    .filter((key) => !IGNORED_KEYS.has(key))
    .sort();
  const differing = keys.filter((key) => canonical(fred[key]) !== canonical(fallback[key]));
  if (differing.length === 0) {
    console.log(`No drift: ${keys.length} config keys identical (ignoring ${[...IGNORED_KEYS].join(", ")}).`);
    process.exit(0);
  }
  console.error(`Drift in ${differing.length} config key(s):`);
  for (const key of differing) {
    if (SENSITIVE.test(key)) {
      console.error(`  ${key}: differs (value hidden)`);
    } else {
      console.error(`  ${key}: fred=${show(fred[key])} fallback=${show(fallback[key])}`);
    }
  }
  process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
