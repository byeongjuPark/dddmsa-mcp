import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { startServer, type RunningServer } from "../src/index.js";

describe("MCP server integration", () => {
  let running: RunningServer;

  beforeAll(async () => {
    running = await startServer(0);
  });

  afterAll(async () => {
    await running.close();
  });

  it("supports listTools and callTool over SSE", async () => {
    const client = new Client(
      { name: "integration-test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`));

    await client.connect(transport);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools.some((tool) => tool.name === "validate_ddd_architecture")).toBe(true);

    const toolResult = await client.callTool({
      name: "validate_ddd_architecture",
      arguments: { targetPath: "src" },
    });

    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content?.[0]?.type).toBe("text");

    await client.close();
  });
});
