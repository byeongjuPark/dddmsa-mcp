import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { logger } from "./utils/logger.js";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { scaffoldDddService } from "./tools/scaffoldDddService.js";
import { validateDddArchitecture } from "./tools/validateDddArchitecture.js";
import { generateCommunicationSpec } from "./tools/generateCommunicationSpec.js";
import { analyzeServiceDependencies } from "./tools/analyzeServiceDependencies.js";
import { generateTestStub } from "./tools/generateTestStub.js";
import { inspectWorkspace } from "./tools/inspectWorkspace.js";
import { explainArchitectureViolation, suggestRefactoringPlan } from "./tools/refactoringGuidance.js";

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
          name: "explain_architecture_violation",
          description: "Explain an architecture finding and why it matters.",
          inputSchema: {
            type: "object",
            properties: {
              finding: {
                type: "object",
                description: "A finding returned by validate_ddd_architecture or analyze_service_dependencies.",
              },
            },
            required: ["finding"],
          },
        },
        {
          name: "suggest_refactoring_plan",
          description: "Turn an architecture finding into a concrete refactoring plan and optional dry-run patch preview.",
          inputSchema: {
            type: "object",
            properties: {
              finding: {
                type: "object",
                description: "A finding returned by validate_ddd_architecture or analyze_service_dependencies.",
              },
              targetPath: {
                type: "string",
                description: "Workspace root used to resolve evidence files. Defaults to current workspace.",
              },
              dryRun: {
                type: "boolean",
                description: "If true, returns a patch preview without writing files.",
              },
            },
            required: ["finding"],
          },
        },
        {
          name: "inspect_workspace",
          description:
            "Inspect a workspace and build a structured project model for DDD/MSA architecture analysis.",
          inputSchema: {
            type: "object",
            properties: {
              targetPath: {
                type: "string",
                description: "The workspace or service root to inspect. Defaults to the current workspace.",
              },
            },
          },
        },
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
        case "explain_architecture_violation":
          result = await explainArchitectureViolation(args as any);
          break;
        case "suggest_refactoring_plan":
          result = await suggestRefactoringPlan(args as any);
          break;
        case "inspect_workspace":
          result = await inspectWorkspace(args as any);
          break;
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
  const sseTransports = new Map<string, SSEServerTransport>();
  const sseServers = new Map<string, Server>();
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();
  const streamableServers = new Map<string, Server>();

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

  app.use((req, res, next) => {
    if (req.path === "/health") return next();

    const allowedOrigins = getAllowedOrigins();
    const origin = req.headers.origin;
    if (origin && allowedOrigins.length > 0 && !isOriginAllowed(origin, allowedOrigins)) {
      logger.warn({ origin, path: req.path }, "Blocked request from disallowed Origin");
      return res.status(403).json({ error: "Forbidden: Origin is not allowed" });
    }

    next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/mcp", async (req, res) => {
    const streamableSessionId = getHeaderValue(req.headers["mcp-session-id"]);
    if (streamableSessionId) {
      const transport = streamableTransports.get(streamableSessionId);
      if (!transport) {
        res.status(404).send("Streamable HTTP session not found or inactive.");
        return;
      }

      await transport.handleRequest(req, res);
      return;
    }

    const transport = new SSEServerTransport("/mcp/messages", res);
    const sessionId = transport.sessionId;
    logger.info({ sessionId }, `[MCP] New SSE connection established.`);

    const server = createMcpServer(sessionId);
    sseTransports.set(sessionId, transport);
    sseServers.set(sessionId, server);
    let cleanedUp = false;

    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;

      logger.info({ sessionId }, `[MCP] SSE connection closed.`);
      transport.onclose = undefined;
      sseTransports.delete(sessionId);
      sseServers.delete(sessionId);
      await server.close().catch((err) => logger.error({ err }, "Error closing server struct"));
    };

    transport.onclose = () => {
      void cleanup();
    };

    await server.connect(transport);
  });

  app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
    await handleStreamableHttpRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    await handleStreamableHttpRequest(req, res);
  });

  app.post("/mcp/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).send("Missing sessionId in query parameters.");
      return;
    }

    const transport = sseTransports.get(sessionId);
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

  async function handleStreamableHttpRequest(req: express.Request, res: express.Response) {
    const sessionId = getHeaderValue(req.headers["mcp-session-id"]);
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId) {
      transport = streamableTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Streamable HTTP session not found or inactive" },
          id: null,
        });
        return;
      }
    } else if (req.method === "POST" && isInitializeRequest(req.body)) {
      const server = createMcpServer("streamable-pending");
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          logger.info({ sessionId: initializedSessionId }, "[MCP] Streamable HTTP session initialized.");
          if (transport) {
            streamableTransports.set(initializedSessionId, transport);
            streamableServers.set(initializedSessionId, server);
          }
        },
      });

      let cleanedUp = false;

      const cleanup = async () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;

        const activeSessionId = transport?.sessionId;
        if (activeSessionId) {
          streamableTransports.delete(activeSessionId);
          streamableServers.delete(activeSessionId);
        }
        await server.close().catch((err) => logger.error({ err }, "Error closing streamable server"));
      };

      transport.onclose = () => {
        void cleanup();
      };

      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid Streamable HTTP session or initialize request" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  }

  const closeSessions = async () => {
    await Promise.all(
      Array.from(sseTransports.values()).map(async (transport) => {
        await transport.close().catch(() => {});
      })
    );
    await Promise.all(
      Array.from(sseServers.values()).map(async (server) => {
        await server.close().catch(() => {});
      })
    );
    await Promise.all(
      Array.from(streamableTransports.values()).map(async (transport) => {
        await transport.close().catch(() => {});
      })
    );
    await Promise.all(
      Array.from(streamableServers.values()).map(async (server) => {
        await server.close().catch(() => {});
      })
    );
    sseTransports.clear();
    sseServers.clear();
    streamableTransports.clear();
    streamableServers.clear();
  };

  return { app, closeSessions };
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.MCP_ALLOWED_ORIGINS;
  if (configuredOrigins) {
    return configuredOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  return ["http://localhost", "http://127.0.0.1"];
}

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    return allowedOrigins.some((allowedOrigin) => {
      const parsedAllowed = new URL(allowedOrigin);
      return (
        parsedAllowed.protocol === parsedOrigin.protocol &&
        parsedAllowed.hostname === parsedOrigin.hostname &&
        parsedAllowed.port === ""
      );
    });
  } catch {
    return false;
  }
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
