import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { logger } from "./utils/logger.js";
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
              dryRun: {
                type: "boolean",
                description: "If true, simulates the creation without writing any files."
              },
              overwrite: {
                type: "boolean",
                description: "If true, allows creating files/folders even if they already exist."
              }
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
              dryRun: {
                type: "boolean",
                description: "If true, diff preview without writing."
              },
              overwrite: {
                type: "boolean",
                description: "If true, overwrites existing spec files."
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
              },
              dryRun: {
                type: "boolean",
                description: "If true, returns a diff preview without writing."
              },
              overwrite: {
                type: "boolean",
                description: "If true, overwrites any existing test file."
              }
            },
            required: ["targetFilePath"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startTime = Date.now();

    logger.info({ sessionId, toolName: name, args }, `[MCP Tool Request] Executing ${name}`);

    try {
      let result;
      switch (name) {
        case "scaffold_ddd_service":
          result = await scaffoldDddService(args as any);
          break;
        case "validate_ddd_architecture":
          result = await validateDddArchitecture(args as any);
          break;
        case "generate_communication_spec":
          result = await generateCommunicationSpec(args as any);
          break;
        case "analyze_service_dependencies":
          result = await analyzeServiceDependencies(args as any);
          break;
        case "generate_test_stub":
          result = await generateTestStub(args as any);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      
      const durationMs = Date.now() - startTime;
      logger.info({ sessionId, toolName: name, durationMs, status: "success" }, `[MCP Tool Success] ${name} completed in ${durationMs}ms`);
      
      // Prometheus-style metrics event
      logger.info({ metric: 'mcp_tool_execution_count', tags: { toolName: name, status: 'success' }, value: 1 }, `METRIC mcp_tool_execution_count 1`);
      logger.info({ metric: 'mcp_tool_execution_latency_ms', tags: { toolName: name }, value: durationMs }, `METRIC mcp_tool_execution_latency_ms ${durationMs}`);

      return result;

    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      logger.error({ sessionId, toolName: name, durationMs, status: "error", errorCode: error.code || "UNKNOWN", error: error.message, stack: error.stack }, `[MCP Tool Error] Error executing tool ${name}: ${error.message}`);
      
      // Prometheus-style metrics event
      logger.info({ metric: 'mcp_tool_execution_count', tags: { toolName: name, status: 'error' }, value: 1 }, `METRIC mcp_tool_execution_count 1`);

      const errorResults = [{
         ruleId: "TOOL-EXEC-FAIL",
         confidence: 0,
         errorCode: error.code || "UNKNOWN_ERR",
         evidence: [{ file: "internal", message: error.message }]
      }];

      return {
        content: [{ type: "text", text: JSON.stringify(errorResults, null, 2) }],
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

  // 1. Request Size Limit Middleware
  app.use((req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || "0", 10);
    if (contentLength > 1024 * 1024) { // 1MB Limit
      logger.warn({ ip: req.ip, contentLength }, "Payload Too Large");
      return res.status(413).send("Payload Too Large");
    }
    next();
  });

  // 2. Rate Limiting Middleware
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10), // Limit each IP
    message: "Too many requests from this IP, please try again after a minute",
    handler: (req, res, next, options) => {
      logger.warn({ ip: req.ip }, "Rate limit exceeded");
      res.status(options.statusCode).send(options.message);
    }
  });
  app.use(limiter);

  // 3. Auth Middleware
  app.use((req, res, next) => {
    if (req.path === "/health") return next();

    const token = process.env.MCP_AUTH_TOKEN;
    if (!token) {
      if (!app.locals.warnedAuth) {
        logger.warn("MCP_AUTH_TOKEN is not set. Server is running WITHOUT authentication!");
        app.locals.warnedAuth = true;
      }
      return next();
    }
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.info({ ip: req.ip, path: req.path }, "Missing or invalid Authorization header");
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const providedToken = authHeader.split(" ")[1];
    if (providedToken !== token) {
      logger.warn({ ip: req.ip }, "Forbidden: Invalid token");
      return res.status(403).json({ error: "Forbidden: Invalid token" });
    }

    next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/mcp", async (req, res) => {
    const transport = new SSEServerTransport("/mcp/messages", res);
    const sessionId = transport.sessionId;
    logger.info({ sessionId }, `[MCP] New SSE connection established.`);

    const server = createMcpServer(sessionId);
    transports.set(sessionId, transport);
    servers.set(sessionId, server);
    let cleanedUp = false;

    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;

      logger.info({ sessionId }, `[MCP] SSE connection closed.`);
      transport.onclose = undefined;
      transports.delete(sessionId);
      servers.delete(sessionId);
      await server.close().catch((err) => logger.error({ err }, "Error closing server struct"));
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
      logger.error({ sessionId, err }, `[MCP] Error handling message`);
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
  logger.info(`DDD+MSA MCP Server is running in SSE mode: http://localhost:${running.port}/mcp`);
  logger.info(`Health check URL: http://localhost:${running.port}/health`);
  logger.info("Add this URL to your Vibe Coding IDE to use the tools over the network.");

  const shutdown = async () => {
    logger.info("[Server] Received shutdown signal. Shutting down gracefully...");
    await running.close();
    logger.info("[Server] Closed HTTP server. Process exiting.");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
