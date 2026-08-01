const KNOWN_COMMANDS = new Set(["start", "new", "stop", "status", "help", "settings", "pro", "web"]);

const COMMAND_RE = /^\/([a-z_][a-z0-9_]{0,31})(?:@([a-z][a-z0-9_]{0,31}))?(?:\s+(.+))?$/iu;
const SLASH_SHAPED_RE = /^\/[a-z_][a-z0-9_]{0,31}(?:@[a-z][a-z0-9_]{0,31})?(?:\s.*)?$/iu;

export interface ParsedSlashCommand {
  command: string;
  botUsername?: string;
  /** Normalized raw argument for pro/web commands (or undefined for bare command).
   *  Semantic validation (on/off/status) belongs in the worker. */
  argument?: string;
}

/**
 * Parse a possible slash command from a Telegram message text.
 * Returns null if the text is not a known command.
 * For /pro and /web, any following text is captured as a raw argument;
 * semantic validation is deferred to the worker.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(COMMAND_RE);
  if (!match) return null;
  const command = (match[1] ?? "").toLowerCase();
  if (!KNOWN_COMMANDS.has(command)) return null;

  const rawArgs = match[3]?.trim().toLowerCase();
  const isProOrWeb = command === "pro" || command === "web";

  if (isProOrWeb) {
    // /pro or /web: capture any raw argument (on/off/status or otherwise);
    // the worker is responsible for semantic validation.
    if (rawArgs !== undefined && rawArgs !== "") {
      return {
        command,
        ...(match[2] ? { botUsername: match[2].toLowerCase() } : {}),
        argument: rawArgs,
      };
    }
    return {
      command,
      ...(match[2] ? { botUsername: match[2].toLowerCase() } : {}),
    };
  }

  // Existing commands: trailing args are ignored (backward-compatible behavior)
  return {
    command,
    ...(match[2] ? { botUsername: match[2].toLowerCase() } : {}),
  };
}

/**
 * Returns true if the given text starts with a known slash command.
 */
export function isKnownSlashCommand(text: string): boolean {
  return parseSlashCommand(text) !== null;
}

/**
 * Returns true if the text is shaped like a slash command (`/word...`)
 * regardless of whether it is one of the known commands. Used to route
 * unrecognized commands to a help/unknown reply instead of Fred, since
 * free text starting with "/" is very unlikely to be a real question.
 */
export function looksLikeSlashCommand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SLASH_SHAPED_RE.test(trimmed);
}

/**
 * Known slash commands list.
 */
export const KNOWN_SLASH_COMMANDS = [...KNOWN_COMMANDS] as const;
