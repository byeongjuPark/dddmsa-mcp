import express from "express";
import cors from "cors";
import type { Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { scaffoldDddService } from "./tools/scaffoldDddService.js";
import { validateDddArchitecture } from "./tools/validateDddArchitecture.js";
import { generateCommunicationSpec } from "./tools/generateCommunicationSpec.js";
import { analyzeServiceDependencies } from "./tools/analyzeServiceDependencies.js";
import { generateTestStub } from "./tools/generateTestStub.js";

export interface RunningServer {
  port: number;
  httpServer: HttpServer;
  close: () => Promise<void>;
}

function createMcpServer(sessionId: string): Server {
  const server = new Server(
    {
      name: "dddmsa-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "scaffold_ddd_service",
          description: "Scaffold a new microservice adopting DDD structure.",
          inputSchema: {
            type: "object",
            properties: {
              serviceName: {
                type: "string",
                description: "The name of the new microservice to create",
              },
              targetPath: {
                type: "string",
                description: "The directory where the service should be created",
              },
              language: {
                type: "string",
                enum: ["typescript", "spring", "auto"],
                description:
                  "The ecosystem/language to scaffold (e.g., 'typescript', 'spring'). Default is 'auto'",
              },
              basePackage: {
                type: "string",
                description: "For Spring: The base package name (e.g., 'com.example.service')",
              },
            },
            required: ["serviceName", "targetPath"],
          },
        },
        {
          name: "validate_ddd_architecture",
          description:
            "Validate the DDD architecture layers of a given directory to ensure no dependency violations.",
          inputSchema: {
            type: "object",
            properties: {
              targetPath: {
                type: "string",
                description: "The root directory of the microservice to validate",
              },
            },
            required: ["targetPath"],
          },
        },
        {
          name: "generate_communication_spec",
          description: "Generate API or messaging specifications (e.g. OpenAPI, gRPC) from controllers/handlers.",
          inputSchema: {
            type: "object",
            properties: {
              sourcePath: {
                type: "string",
                description: "The path containing the controllers/handlers to scan",
              },
              outputFormat: {
                type: "string",
                enum: ["openapi", "grpc"],
                description: "The format of the spec to generate",
              },
              language: {
                type: "string",
                enum: ["typescript", "spring", "auto"],
                description: "The language context of the source files. Default is 'auto'",
              },
            },
            required: ["sourcePath", "outputFormat"],
          },
        },
        {
          name: "analyze_service_dependencies",
          description: "Analyze and output a list of dependencies this service has on other microservices.",
          inputSchema: {
            type: "object",
            properties: {
              targetPath: {
                type: "string",
                description: "The root directory of the microservice to analyze",
              },
            },
            required: ["targetPath"],
          },
        },
        {
          name: "generate_test_stub",
          description: "Create a boilerplate test file for a given source code file.",
          inputSchema: {
            type: "object",
            properties: {
              targetFilePath: {
                type: "string",
                description: "The relative path to the source file to be tested",
              },
              language: {
                type: "string",
                enum: ["typescript", "spring", "auto"],
                description: "The language context. Default is 'auto'.",
              },
            },
            required: ["targetFilePath"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    console.log(`[MCP Tool Request] Session: ${sessionId} | Tool: ${name}`);

    try {
      switch (name) {
        case "scaffold_ddd_service":
          return await scaffoldDddService(args as any);
        case "validate_ddd_architecture":
          return await validateDddArchitecture(args as any);
        case "generate_communication_spec":
          return await generateCommunicationSpec(args as any);
        case "analyze_service_dependencies":
          return await analyzeServiceDependencies(args as any);
        case "generate_test_stub":
          return await generateTestStub(args as any);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      console.error(`[MCP Tool Error] Session: ${sessionId} | Tool: ${name} | Error: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool ${name}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

async function createApp() {
  const app = express();
  const transports = new Map<string, SSEServerTransport>();
  const servers = new Map<string, Server>();

  app.use(cors());

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/mcp", async (req, res) => {
    const transport = new SSEServerTransport("/mcp/messages", res);
    const sessionId = transport.sessionId;
    console.log(`[MCP] New SSE connection established. Session: ${sessionId}`);

    const server = createMcpServer(sessionId);
    transports.set(sessionId, transport);
    servers.set(sessionId, server);
    let cleanedUp = false;

    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;

      console.log(`[MCP] SSE connection closed. Session: ${sessionId}`);
      transport.onclose = undefined;
      transports.delete(sessionId);
      servers.delete(sessionId);
      await server.close().catch((err) => console.error("Error closing server struct", err));
    };

    transport.onclose = () => {
      void cleanup();
    };

    await server.connect(transport);
  });

  app.post("/mcp/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).send("Missing sessionId in query parameters.");
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).send("Session not found or inactive.");
      return;
    }

    try {
      await transport.handlePostMessage(req, res);
    } catch (err: any) {
      console.error(`[MCP] Error handling message for session ${sessionId}:`, err);
      res.status(500).send("Message handling failed.");
    }
  });

  const closeSessions = async () => {
    await Promise.all(
      Array.from(transports.values()).map(async (transport) => {
        await transport.close().catch(() => {});
      })
    );
    await Promise.all(
      Array.from(servers.values()).map(async (server) => {
        await server.close().catch(() => {});
      })
    );
    transports.clear();
    servers.clear();
  };

  return { app, closeSessions };
}

export async function startServer(port = Number(process.env.PORT ?? 3001)): Promise<RunningServer> {
  const { app, closeSessions } = await createApp();

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });

  const address = httpServer.address();
  const resolvedPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    port: resolvedPort,
    httpServer,
    close: async () => {
      await closeSessions();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const running = await startServer(Number(process.env.PORT ?? 3001));
  console.log(`DDD+MSA MCP Server is running in SSE mode: http://localhost:${running.port}/mcp`);
  console.log(`Health check URL: http://localhost:${running.port}/health`);
  console.log("Add this URL to your Vibe Coding IDE to use the tools over the network.");

  const shutdown = async () => {
    console.log("\n[Server] Received shutdown signal. Shutting down gracefully...");
    await running.close();
    console.log("[Server] Closed HTTP server. Process exiting.");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
