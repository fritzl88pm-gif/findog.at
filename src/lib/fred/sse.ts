/**
 * Fred SSE (Server-Sent Events) helpers.
 *
 * Browser-safe pure functions for incremental SSE frame parsing,
 * event sanitization, and frame formatting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FredSseEvent = {
  response_type: string;
  content?: string;
  assistant_message_id?: string;
  data?: unknown;
  [key: string]: unknown;
};

export type SseParseResult = {
  /** Fully parsed events from the buffer. */
  events: FredSseEvent[];
  /** Unconsumed partial data (incomplete frame). */
  remainder: string;
};

// ---------------------------------------------------------------------------
// Incremental SSE parser
// ---------------------------------------------------------------------------

/**
 * Parse SSE data incrementally across arbitrary chunk boundaries.
 *
 * Handles LF and CRLF line endings.  Ignores comment lines (`:`).
 * Collects `data:` lines per frame; when a blank line (frame delimiter) is
 * reached, tries to JSON-parse the concatenated data content.
 * Also respects `event:` type but processes every frame regardless of type.
 * Preserves unconsumed trailing partial data as `remainder`.
 */
export function parseSseChunk(buffer: string): SseParseResult {
  const events: FredSseEvent[] = [];
  const delimiterPattern = /\r\n\r\n|\n\n/g;
  let frameStart = 0;
  let delimiter: RegExpExecArray | null;

  while ((delimiter = delimiterPattern.exec(buffer)) !== null) {
    const frame = buffer.slice(frameStart, delimiter.index);
    frameStart = delimiter.index + delimiter[0].length;

    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => {
        const value = line.slice(5);
        return value.startsWith(" ") ? value.slice(1) : value;
      });

    if (dataLines.length === 0) {
      continue;
    }

    const data = dataLines.join("\n");
    if (!data) {
      continue;
    }

    try {
      const parsed = JSON.parse(data) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).response_type === "string"
      ) {
        events.push(parsed as FredSseEvent);
      }
    } catch {
      // Malformed JSON frames are ignored.
    }
  }

  return { events, remainder: buffer.slice(frameStart) };
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Strip sensitive fields from Fred events for safe relay to the browser.
 *
 * - `thinking`: return only `{ response_type: "thinking" }`
 * - `tool_call`, `tool_result`: return only `{ response_type }`
 * - `answer`: keep `response_type` + `content`; strip `data`
 * - `agent_query`: keep `response_type` + `assistant_message_id`; strip `content`, `data`
 * - `error`: keep `response_type` + `content`; strip `data`
 * - `complete`: keep only the completion marker
 * - unknown types: keep only their type marker
 */
export function sanitizeFredEvent(event: FredSseEvent): FredSseEvent {
  switch (event.response_type) {
    case "thinking":
      return { response_type: "thinking" };

    case "tool_call":
      return { response_type: "tool_call" };

    case "tool_result":
      return { response_type: "tool_result" };

    case "answer":
      return {
        response_type: "answer",
        ...(typeof event.content === "string" ? { content: event.content } : {}),
      };

    case "agent_query":
      return {
        response_type: "agent_query",
        ...(typeof event.assistant_message_id === "string"
          ? { assistant_message_id: event.assistant_message_id }
          : {}),
      };

    case "error":
      return {
        response_type: "error",
        ...(typeof event.content === "string" ? { content: event.content } : {}),
      };

    case "complete":
      return { response_type: "complete" };

    default:
      return { response_type: event.response_type };
  }
}

// ---------------------------------------------------------------------------
// Frame formatting
// ---------------------------------------------------------------------------

/**
 * Format a Fred SSE event as a valid SSE frame:
 *
 *   event: message\n
 *   data: <json>\n
 *   \n
 */
export function isTerminalFredEvent(event: FredSseEvent): boolean {
  return event.response_type === "complete" || event.response_type === "error";
}

export function formatSseFrame(event: FredSseEvent): string {
  return `event: message\ndata: ${JSON.stringify(event)}\n\n`;
}
