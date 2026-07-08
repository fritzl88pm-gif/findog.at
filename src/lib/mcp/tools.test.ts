import { describe, expect, it } from "vitest";

import { mcpToolToDeepSeekTool } from "./tools";

describe("mcpToolToDeepSeekTool", () => {
  it("maps an MCP tool to an OpenAI-compatible DeepSeek function tool", () => {
    const tool = mcpToolToDeepSeekTool({
      name: "bfg_search",
      description: "Search BFG decisions",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
    });

    expect(tool).toEqual({
      type: "function",
      function: {
        name: "bfg_search",
        description: "Search BFG decisions",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
          },
          required: ["query"],
        },
      },
    });
  });

  it("uses an empty object schema when the MCP tool omits inputSchema", () => {
    const tool = mcpToolToDeepSeekTool({
      name: "health",
      description: "",
    });

    expect(tool.function.parameters).toEqual({
      type: "object",
      properties: {},
    });
  });
});
