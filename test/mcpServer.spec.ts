import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
    expect(toolsResult.tools.some((tool) => tool.name === "explain_architecture_violation")).toBe(true);
    expect(toolsResult.tools.some((tool) => tool.name === "suggest_refactoring_plan")).toBe(true);
    expect(toolsResult.tools.some((tool) => tool.name === "inspect_workspace")).toBe(true);
    expect(toolsResult.tools.some((tool) => tool.name === "validate_ddd_architecture")).toBe(true);

    const toolResult = await client.callTool({
      name: "validate_ddd_architecture",
      arguments: { targetPath: "src" },
    });

    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content?.[0]?.type).toBe("text");

    await client.close();
  });

  it("supports listTools and callTool over Streamable HTTP", async () => {
    const client = new Client(
      { name: "streamable-http-test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`));

    await client.connect(transport);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools.some((tool) => tool.name === "inspect_workspace")).toBe(true);

    const toolResult = await client.callTool({
      name: "inspect_workspace",
      arguments: { targetPath: "test/fixtures/typescript-mock" },
    });

    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.content?.[0]?.type).toBe("text");

    await client.close();
  });

  it("rejects disallowed origins on MCP endpoints", async () => {
    const response = await fetch(`http://127.0.0.1:${running.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(response.status).toBe(403);
  });
});
