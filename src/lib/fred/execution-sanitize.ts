/**
 * Masking helpers for everything Fred's execution trace may show to a browser.
 *
 * All functions are pure and idempotent: running them over already-sanitized text must not change
 * it, because streamed steps are sanitized on the server, again when parsed by the client and again
 * when stored traces are read back.
 */
import {
  isSensitiveQueryParam,
  redactSensitiveText,
  sanitizeControlCharacters,
} from "./safe-research-display";

export const EXECUTION_CUT_MARKER = "…[gekürzt]";
export const MASKED_ID = "[ID]";
export const MASKED_HOST = "[intern]";
export const MASKED_MODEL = "[Modell]";
export const MASKED_ENV_BLOCK = "[Umgebungsvariablen ausgeblendet]";

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const PAYLOAD_PRE_CUT_CHARS = 400_000;

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const LONG_HEX_PATTERN = /\b[0-9a-f]{32,}\b/giu;

const INTERNAL_SERVICE_NAMES = [
  "app", "mcp", "db", "redis", "postgres", "postgresql", "weknora", "docreader", "minio", "neo4j",
  "ollama", "sandbox", "api", "backend", "frontend", "worker", "nginx", "traefik", "supabase", "kong",
  "searxng", "jaeger", "localhost", "host\\.docker\\.internal",
].join("|");
const SERVICE_HOST_PORT_PATTERN = new RegExp(`\\b(?:${INTERNAL_SERVICE_NAMES}):\\d{2,5}\\b`, "giu");
const INTERNAL_DOMAIN_PATTERN =
  /\b(?:[a-z0-9-]+\.)*[a-z0-9-]+\.(?:sslip\.io|nip\.io|traefik\.me|internal|local|lan|svc|localdomain|corp|intra|cluster\.local)\b(?::\d{2,5})?/giu;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/gu;

const MODEL_PATTERN = new RegExp(
  "\\b(?:" + [
    "gpt-?\\d[\\w.-]*",
    "chatgpt[\\w.-]*",
    "o[134]-(?:mini|preview|pro)",
    "claude[-_ ]?(?:\\d|opus|sonnet|haiku|instant)[\\w.-]*",
    "gemini[-_ ]?(?:\\d|pro|flash|ultra|nano)[\\w.-]*",
    "gemma[-:]\\w[\\w.:-]*",
    "qwen[\\w.:-]*",
    "llama[-_ ]?\\d[\\w.:-]*",
    "mi[sx]tral[\\w.:-]*",
    "deepseek[\\w.:-]*",
    "glm-?\\d[\\w.-]*",
    "command-r[\\w-]*",
    "text-embedding-[\\w.-]+",
    "(?:bge|gte|e5|jina|rerank|nomic-embed)-[\\w.:-]+",
  ].join("|") + ")\\b",
  "giu",
);
const PROVIDER_PATTERN =
  /\b(?:openai|anthropic|openrouter|ollama|azure[ -]?openai|vertex ?ai|bedrock|groq|together\.ai|siliconflow|moonshot|dashscope|zhipu|huggingface)\b/giu;

const SYSTEM_ROOTS = "etc|var|tmp|opt|home|root|usr|proc|sys|mnt|srv|app|bin|sbin|dev|lib|run|data|Users|private|workspace|work|workdir|sandbox";
const ABSOLUTE_PATH_PATTERN = new RegExp(
  `(?<![\\w:/.~\\\\-])(?:(?:/[\\w.@+~-]+){2,}/?|/(?:${SYSTEM_ROOTS})(?![\\w/-]))`,
  "gu",
);
const WORKING_DIRECTORY_PATTERN = /^\/(?:workspace|work|workdir|sandbox|mnt\/data)(?=\/|$)/u;

const ENV_LINE_PATTERN = /^\s*(?:export\s+|declare -x\s+)?[A-Z_][A-Z0-9_]+=.*$/u;
const SENSITIVE_ENV_KEY_PATTERN = /(?:KEY|SECRET|TOKEN|PASS|AUTH|CREDENTIAL|PRIVATE|DSN|URL|URI|HOST|USER|SALT|SIGNATURE|COOKIE)/u;

const INTERNAL_KEY_PATTERN =
  /(?:^|[_-])(?:id|ids|uuid|guid|key|token|secret|password|passwd|credential|credentials|model|models|provider|host|hostname|endpoint|baseurl|base_url|apibase|api_base|tenant|session|dsn|cookie|authorization)$/iu;

/** Keys whose value is an internal identifier or infrastructure detail and must never be displayed. */
export function isInternalKey(rawKey: string): boolean {
  const key = rawKey.replace(/([a-z])([A-Z])/gu, "$1_$2");
  return INTERNAL_KEY_PATTERN.test(key) || isSensitiveQueryParam(rawKey);
}

export function maskUuids(text: string): string {
  return text.replace(UUID_PATTERN, MASKED_ID).replace(LONG_HEX_PATTERN, MASKED_ID);
}

function isValidIpv4(candidate: string): boolean {
  const [address] = candidate.split(":");
  return address.split(".").every((part) => Number(part) <= 255);
}

export function maskInternalHosts(text: string): string {
  return text
    .replace(SERVICE_HOST_PORT_PATTERN, MASKED_HOST)
    .replace(INTERNAL_DOMAIN_PATTERN, MASKED_HOST)
    .replace(IPV4_PATTERN, (match) => (isValidIpv4(match) ? MASKED_HOST : match));
}

export function maskModelNames(text: string): string {
  return text
    .replace(MODEL_PATTERN, (match) => {
      // Keep sentence punctuation that the greedy name pattern may have swallowed.
      const trailing = /[.\-:]+$/u.exec(match)?.[0] ?? "";
      return `${MASKED_MODEL}${trailing}`;
    })
    .replace(PROVIDER_PATTERN, MASKED_MODEL);
}

/** Absolute paths outside the sandbox working directory shrink to their basename. */
export function maskAbsolutePaths(text: string): string {
  return text.replace(ABSOLUTE_PATH_PATTERN, (path) => {
    if (WORKING_DIRECTORY_PATTERN.test(path)) {
      const relative = path.replace(WORKING_DIRECTORY_PATTERN, "").replace(/^\//u, "");
      return relative ? `./${relative}` : ".";
    }
    const segments = path.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  });
}

/** Collapses `env`-style dumps and masks values of secret-looking KEY=VALUE lines. */
export function maskEnvironmentDumps(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!ENV_LINE_PATTERN.test(lines[index])) {
      result.push(lines[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && ENV_LINE_PATTERN.test(lines[end])) end += 1;
    if (end - index >= 3) {
      result.push(MASKED_ENV_BLOCK);
    } else {
      for (let line = index; line < end; line += 1) {
        result.push(lines[line].replace(
          /^(\s*(?:export\s+|declare -x\s+)?)([A-Z_][A-Z0-9_]+)=.*$/u,
          (match, prefix: string, key: string) => (SENSITIVE_ENV_KEY_PATTERN.test(key)
            ? `${prefix}${key}=[REDACTED]`
            : match),
        ));
      }
    }
    index = end;
  }
  return result.join("\n");
}

type DisplayTextOptions = {
  /** Mask KEY=VALUE environment dumps (command output). */
  environment?: boolean;
};

/** Full masking pipeline without length handling. */
export function maskDisplayText(value: string, options: DisplayTextOptions = {}): string {
  let text = sanitizeControlCharacters(value.replace(ANSI_ESCAPE_PATTERN, ""));
  // Bearer tokens first: "Authorization: Bearer <token>" would otherwise only mask the word "Bearer".
  text = text.replace(/\bBearer\s+[A-Za-z0-9_\-.~+/]+=*/giu, "Bearer [REDACTED]");
  text = maskAbsolutePaths(text);
  if (options.environment) text = maskEnvironmentDumps(text);
  text = redactSensitiveText(text);
  return maskModelNames(maskInternalHosts(maskUuids(text)));
}

/** Single-line / short text: masked, whitespace-collapsed and cut with an ellipsis (idempotent). */
export function sanitizeDisplayLine(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = maskDisplayText(value.slice(0, PAYLOAD_PRE_CUT_CHARS)).replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  return capText(text, maximum);
}

/** Multi-line text, masked and cut with an ellipsis (idempotent). */
export function sanitizeDisplayBlock(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = maskDisplayText(value.slice(0, PAYLOAD_PRE_CUT_CHARS)).replace(/[ \t]+\n/gu, "\n").trim();
  if (!text) return undefined;
  return capText(text, maximum);
}

export function capText(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const cut = text.slice(0, maximum);
  const boundary = cut.search(/\s\S*$/u);
  return `${(boundary > maximum * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * Terminal-style payloads: masked, then cut with a visible marker.
 * `keep: "tail"` keeps the END (rolling output); the cut is idempotent for already-cut text.
 */
export function sanitizePayload(
  value: unknown,
  maximum: number,
  keep: "head" | "tail" = "head",
  options: DisplayTextOptions = {},
): string | undefined {
  if (typeof value !== "string") return undefined;
  const bounded = keep === "head" ? value.slice(0, PAYLOAD_PRE_CUT_CHARS) : value.slice(-PAYLOAD_PRE_CUT_CHARS);
  if (!bounded.trim()) return undefined;
  const text = maskDisplayText(bounded, options);
  if (!text.trim()) return undefined;
  const alreadyCut = keep === "head"
    ? text.endsWith(`\n${EXECUTION_CUT_MARKER}`)
    : text.startsWith(`${EXECUTION_CUT_MARKER}\n`);
  if (text.length <= maximum + (alreadyCut ? EXECUTION_CUT_MARKER.length + 1 : 0)) return text;
  return keep === "head"
    ? `${text.slice(0, maximum)}\n${EXECUTION_CUT_MARKER}`
    : `${EXECUTION_CUT_MARKER}\n${text.slice(-maximum)}`;
}

type SourceReferenceLike = { kind: string; knowledgeBaseId?: string; chunkId?: string };

/** Advanced-mode responses never carry knowledge-base or chunk ids (the browser only needs names and links). */
export function stripSourceReferenceIds<T extends SourceReferenceLike>(sources: readonly T[]): T[] {
  return sources.map((source) => {
    if (source.knowledgeBaseId === undefined && source.chunkId === undefined) return source;
    const { knowledgeBaseId: _knowledgeBaseId, chunkId: _chunkId, ...rest } = source;
    void _knowledgeBaseId;
    void _chunkId;
    return rest as T;
  });
}
