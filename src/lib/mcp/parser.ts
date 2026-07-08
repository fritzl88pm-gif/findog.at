type JsonPayload = Record<string, unknown>;

function parseJsonPayload(value: string): JsonPayload[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[DONE]") {
    return [];
  }

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is JsonPayload =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      );
    }
    if (typeof parsed === "object" && parsed !== null) {
      return [parsed as JsonPayload];
    }
  } catch {
    return [];
  }

  return [];
}

export function extractJsonPayloads(body: string): JsonPayload[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const plainJson = parseJsonPayload(trimmed);
    if (plainJson.length > 0) {
      return plainJson;
    }
  }

  const payloads: JsonPayload[] = [];
  const events = body.split(/\r?\n\r?\n/);

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    const combinedPayloads = parseJsonPayload(dataLines.join("\n"));
    if (combinedPayloads.length > 0) {
      payloads.push(...combinedPayloads);
      continue;
    }

    for (const dataLine of dataLines) {
      payloads.push(...parseJsonPayload(dataLine));
    }
  }

  return payloads;
}
