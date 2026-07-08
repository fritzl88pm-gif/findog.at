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
    return { ...emptyObjectSchema };
  }

  if ("type" in inputSchema && inputSchema.type !== "object") {
    return { ...emptyObjectSchema };
  }

  if (inputSchema.type === "object") {
    return inputSchema;
  }

  return {
    type: "object",
    ...inputSchema,
  };
}

export function mcpToolToDeepSeekTool(tool: McpTool): DeepSeekTool {
  const description = tool.description?.trim() || `BFG/WeKnora MCP tool: ${tool.name}`;

  return {
    type: "function",
    function: {
      name: tool.name,
      description,
      parameters: normalizeInputSchema(tool.inputSchema),
    },
  };
}
