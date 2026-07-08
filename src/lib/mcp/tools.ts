export type JsonObject = Record<string, unknown>;

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
};

export type DeepSeekTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
};

const emptyObjectSchema: JsonObject = {
  type: "object",
  properties: {},
};

export function normalizeInputSchema(inputSchema?: JsonObject): JsonObject {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return emptyObjectSchema;
  }

  return inputSchema;
}

export function mcpToolToDeepSeekTool(tool: McpTool): DeepSeekTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: normalizeInputSchema(tool.inputSchema),
    },
  };
}
