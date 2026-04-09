import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
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

const app = express();
const port = process.env.PORT || 3001;

// 1. App middlewares
app.use(cors());

// 2. Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 3. Multi-client session management
const transports = new Map<string, SSEServerTransport>();
const servers = new Map<string, Server>();

// Function to create a server instance per connection to avoid state collision
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

  // Register tools
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
                description: "The ecosystem/language to scaffold (e.g., 'typescript', 'spring'). Default is 'auto'",
              },
              basePackage: {
                type: "string",
                description: "For Spring: The base package name (e.g., 'com.example.service')",
              }
            },
            required: ["serviceName", "targetPath"],
          },
        },
        {
          name: "validate_ddd_architecture",
          description: "Validate the DDD architecture layers of a given directory to ensure no dependency violations.",
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
              }
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
              }
            },
            required: ["targetFilePath"],
          },
        },
      ],
    };
  });

  // Handle tool execution + 4. Error Handling and Server Logging Enhancements
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

// Start Express Server for SSE
app.get("/mcp", async (req, res) => {
  const sessionId = uuidv4();
  console.log(`[MCP] New SSE connection established. Session: ${sessionId}`);
  
  // Construct the messages endpoint url specific to this session
  const transport = new SSEServerTransport(`/mcp/messages?sessionId=${sessionId}`, res);
  transports.set(sessionId, transport);
  
  const server = createMcpServer(sessionId);
  servers.set(sessionId, server);
  
  res.on('close', async () => {
    console.log(`[MCP] SSE connection closed. Session: ${sessionId}`);
    
    const s = servers.get(sessionId);
    if (s) {
      await s.close().catch(err => console.error("Error closing server struct", err));
    }

    transports.delete(sessionId);
    servers.delete(sessionId);
  });

  await server.connect(transport);
});

// Message handling endpoint per session
app.post("/mcp/messages", express.json(), async (req, res) => {
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

const httpServer = app.listen(port, () => {
  console.log(`🚀 DDD+MSA MCP Server is running in SSE mode: http://localhost:${port}/mcp`);
  console.log(`🩺 Health check URL: http://localhost:${port}/health`);
  console.log(`Add this URL to your Vibe Coding IDE to use the tools over the network.`);
});

// 5. Graceful shutdown
const shutdown = () => {
  console.log("\n[Server] Received shutdown signal. Shutting down gracefully...");
  
  transports.forEach(async (t) => {
    await t.close().catch(() => {});
  });
  servers.forEach(async (s) => {
    await s.close().catch(() => {});
  });
  
  transports.clear();
  servers.clear();

  httpServer.close(() => {
    console.log("[Server] Closed HTTP server. Process exiting.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
