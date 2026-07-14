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
