import { runWithTimeout } from "@/lib/deadline";
import { BfgProModelError } from "./bfg-pro";

export const BFG_PRO_LUNA_MODEL = "codex/gpt-5.6-luna" as const;
export const BFG_PRO_LUNA_REASONING_EFFORT = "medium" as const;
export const BFG_PRO_LUNA_DEFAULT_TIMEOUT_MS = 600_000;
export const BFG_PRO_LUNA_DEFAULT_MAX_TOKENS = 16_000;

export type BfgProChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompleteBfgProLunaOptions = {
  messages: BfgProChatMessage[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
};

export function normalizeOmnirouteChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  const withoutV1 = trimmed.replace(/\/v1$/u, "");
  return `${withoutV1}/v1/chat/completions`;
}

function resolveOmnirouteConfig(): { url: string; apiKey: string } {
  const baseUrl = process.env.OMNIROUTE_BASE_URL?.trim() ?? "";
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim() ?? "";
  if (!baseUrl || !apiKey) {
    throw new BfgProModelError();
  }
  return {
    url: normalizeOmnirouteChatCompletionsUrl(baseUrl),
    apiKey,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function completeBfgProLuna(options: CompleteBfgProLunaOptions): Promise<string> {
  const { url, apiKey } = resolveOmnirouteConfig();
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BFG_PRO_LUNA_DEFAULT_TIMEOUT_MS;
  const maxTokens = options.maxTokens ?? BFG_PRO_LUNA_DEFAULT_MAX_TOKENS;

  try {
    const rawContent = await runWithTimeout(
      async (signal) => {
        const response = await fetcher(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: BFG_PRO_LUNA_MODEL,
            messages: options.messages,
            reasoning_effort: BFG_PRO_LUNA_REASONING_EFFORT,
            response_format: { type: "json_object" },
            stream: false,
            max_tokens: maxTokens,
          }),
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          throw new BfgProModelError();
        }

        const readBodyWithSignal = async (): Promise<string> => {
          if (signal.aborted) {
            throw signal.reason ?? new BfgProModelError();
          }
          return new Promise<string>((resolve, reject) => {
            const onAbort = () => reject(signal.reason ?? new BfgProModelError());
            signal.addEventListener("abort", onAbort, { once: true });
            response.text().then(
              (text) => {
                signal.removeEventListener("abort", onAbort);
                resolve(text);
              },
              (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
              },
            );
          });
        };

        const rawText = await readBodyWithSignal();
        let payload: unknown;
        try {
          payload = JSON.parse(rawText);
        } catch {
          throw new BfgProModelError();
        }

        if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
          throw new BfgProModelError();
        }

        const firstChoice = payload.choices[0];
        if (!isRecord(firstChoice)) {
          throw new BfgProModelError();
        }

        if (firstChoice.finish_reason !== "stop") {
          throw new BfgProModelError();
        }

        const message = firstChoice.message;
        if (!isRecord(message) || typeof message.content !== "string" || !message.content.trim()) {
          throw new BfgProModelError();
        }

        return message.content;
      },
      { timeoutMs, timeoutMessage: "OmniRoute request timed out." },
    );

    return rawContent;
  } catch (error) {
    if (error instanceof BfgProModelError) {
      throw error;
    }
    throw new BfgProModelError();
  }
}
