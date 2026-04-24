# DDD+MSA MCP Server

![MCP Architecture](./mcp_architecture.png)

## English

DDD+MSA MCP Server is a Streamable HTTP-based Model Context Protocol (MCP) server for microservice projects.
It also provides compatibility endpoints for legacy SSE clients.
It provides tools for DDD scaffolding, architecture validation, communication spec generation, dependency analysis, and test stub generation.

### Features

#### Available MCP Tools

1. `inspect_workspace`
- Purpose: build a project model with language, build tool, DDD layers, entrypoints, repositories, and dependency signals.
- Optional args: `targetPath` (defaults to current workspace)

2. `explain_architecture_violation`
- Purpose: explain a finding returned by `validate_ddd_architecture` or `analyze_service_dependencies`.
- Required args: `finding`

3. `suggest_refactoring_plan`
- Purpose: convert a finding into a step-by-step refactoring plan and verification checklist.
- Required args: `finding`
- Optional args: `targetPath`, `dryRun`

4. `scaffold_ddd_service`
- Purpose: create a DDD 4-layer service skeleton.
- Required args: `serviceName`, `targetPath`
- Optional args: `language` (`typescript` | `spring` | `auto`), `basePackage`, `dryRun`, `overwrite`

5. `validate_ddd_architecture`
- Purpose: detect invalid layer dependencies (domain/application violations).
- Required args: `targetPath`
- Note: if `.dddmsa.json` exists in the target path, custom layers and rules are applied.

6. `generate_communication_spec`
- Purpose: scan handlers/controllers and generate API specs.
- Required args: `sourcePath`, `outputFormat` (`openapi` | `grpc`)
- Optional args: `language`, `dryRun`, `overwrite`
- Note: TypeScript request/response DTO types are converted into OpenAPI `components.schemas`, and each endpoint includes `x-source.file/line`.
- Note: Java/Spring mapping annotations include line information when available.

7. `analyze_service_dependencies`
- Purpose: find HTTP/event/gRPC/infrastructure dependencies and analyze the service graph.
- Required args: `targetPath`
- Note: in `services/<service-name>` or `apps/<app-name>` layouts, shared database models/resources across services are reported as `MSA-DB-SHARED`.
- Note: service-to-service edges are returned as `DEP-GRAPH`; cyclic calls are reported as `DEP-GRAPH-CYCLE`; high coupling is reported as `DEP-GRAPH-HOTSPOT`.
- Note: file-level extraction failures do not abort the whole analysis; they are returned as `DEP-ANALYSIS-WARN`.

8. `generate_test_stub`
- Purpose: generate a test stub from a source file.
- Required args: `targetFilePath`
- Optional args: `language` (`typescript` | `spring` | `auto`), `dryRun`, `overwrite`

### Requirements

- Node.js 20+
- npm 10+

### Install and Run

```bash
git clone https://github.com/byeongjuPark/dddmsa-msa.git
cd dddmsa-msa
npm install
npm run build
npm run start
```

Development mode:

```bash
npm run dev
```

Default server URLs:

- MCP Streamable HTTP endpoint: `http://localhost:3001/mcp`
- Legacy HTTP+SSE compatibility endpoints: `GET http://localhost:3001/mcp`, `POST http://localhost:3001/mcp/messages?sessionId=...`
- Health check: `http://localhost:3001/health`

### Environment Variables

- `PORT`: HTTP port (default: `3001`)
- `MCP_AUTH_TOKEN`: bearer token for authentication (if unset, auth is disabled)
- `MCP_ALLOWED_ORIGINS`: comma-separated allowed origins (default: `http://localhost,http://127.0.0.1`)
- `RATE_LIMIT_MAX`: max requests per IP per minute (default: `100`)
- `WORKSPACE_ALLOWLIST`: optional comma-separated absolute path allowlist for file operations
- `LOG_LEVEL`: pino log level (default: `info`)
- `NODE_ENV=production`: disables pretty log transport

### Authentication and Security

#### Auth behavior

- `GET /health` is always public.
- If `MCP_AUTH_TOKEN` is not set, the server runs without auth.
- If `MCP_AUTH_TOKEN` is set, all paths except `/health` require
  `Authorization: Bearer <token>`.

Failure responses:

- `401`: missing or malformed `Authorization` header
- `403`: token mismatch

#### Request guardrails

- Request body size limit: `1 MB` (`413 Payload Too Large`)
- Rate limit: per-IP per minute (`429 Too Many Requests`)
- Origin validation: only origins included in `MCP_ALLOWED_ORIGINS` are allowed
- Path traversal/symlink escape protection is enforced by `resolveSafePath`
- If `WORKSPACE_ALLOWLIST` is set, resolved paths must stay inside allowed roots

### MCP Usage

#### 1) MCP client connection

Use the MCP base URL:

```json
{
  "mcpServers": {
    "dddmsa-mcp": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

If auth is enabled, configure client headers to include:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

Notes:
- Streamable HTTP clients initialize with `POST /mcp` and send follow-up requests to the same URL.
- Legacy SSE clients connect to `GET /mcp` without an MCP session header and then post messages to `/mcp/messages?sessionId=...`.

#### 2) Programmatic example (MCP SDK)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const client = new Client(
  { name: "example-client", version: "1.0.0" },
  { capabilities: {} }
);

const transport = new SSEClientTransport(new URL("http://127.0.0.1:3001/mcp"));
await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map(t => t.name));

const result = await client.callTool({
  name: "validate_ddd_architecture",
  arguments: { targetPath: "src" }
});

console.log(result);
await client.close();
```

#### 3) Tool argument examples

`inspect_workspace`

```json
{
  "targetPath": "services/order-service"
}
```

`scaffold_ddd_service`

```json
{
  "serviceName": "order-service",
  "targetPath": "services",
  "language": "spring",
  "basePackage": "com.example.order",
  "dryRun": true
}
```

`validate_ddd_architecture`

```json
{
  "targetPath": "services/order-service"
}
```

`suggest_refactoring_plan`

```json
{
  "finding": {
    "ruleId": "DDD-004",
    "confidence": 1,
    "evidence": [
      {
        "file": "presentation/orderController.ts",
        "message": "presentation layer violates disallowed infrastructure layer via ../infrastructure/sqlOrderRepository"
      }
    ],
    "errorCode": "DEPENDENCY_VIOLATION"
  },
  "targetPath": "services/order-service",
  "dryRun": true
}
```

`generate_communication_spec`

```json
{
  "sourcePath": "services/order-service/src",
  "outputFormat": "openapi",
  "dryRun": true
}
```

OpenAPI example:

```json
{
  "paths": {
    "/orders": {
      "post": {
        "x-source": { "file": "routes.ts", "line": 15 },
        "requestBody": {
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateOrderRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/OrderResponse" }
              }
            }
          }
        }
      }
    }
  }
}
```

`analyze_service_dependencies`

```json
{
  "targetPath": "services/order-service"
}
```

Example result:

```json
[
  {
    "ruleId": "DEP-GRAPH",
    "confidence": 1,
    "evidence": [
      {
        "file": "services/order-service/src/client.ts",
        "message": "order-service -> billing-service [sync-http]"
      }
    ],
    "recommendation": "Use this service graph to review runtime coupling, ownership boundaries, and integration style."
  },
  {
    "ruleId": "DEP-GRAPH-CYCLE",
    "confidence": 0.85,
    "evidence": [
      { "file": "services", "message": "Service cycle member: order-service" },
      { "file": "services", "message": "Service cycle member: billing-service" }
    ],
    "errorCode": "SERVICE_DEPENDENCY_CYCLE"
  }
]
```

`generate_test_stub`

```json
{
  "targetFilePath": "src/application/useCases/createOrder.ts",
  "language": "typescript",
  "dryRun": true
}
```

### Tool Result Format

Most tools return `content[0].text` as a JSON array:

```json
[
  {
    "ruleId": "EXAMPLE-RULE",
    "confidence": 1,
    "evidence": [
      { "file": "src/file.ts", "message": "..." }
    ],
    "recommendation": "optional",
    "errorCode": "optional"
  }
]
```

If execution fails, MCP response includes `isError: true`.

### Architecture Rule Configuration

Place `.dddmsa.json` in a service root to override default DDD rules with project-specific layer names and dependency constraints.
Default rules detect reverse layer dependencies, domain framework leakage, presentation-to-repository access, and entity imports across bounded contexts.

```json
{
  "layers": {
    "domain": ["domain", "core"],
    "application": ["application", "usecases"],
    "infrastructure": ["infrastructure", "adapters"],
    "presentation": ["presentation", "api"]
  },
  "rules": [
    {
      "id": "DDD-001",
      "fromLayer": "domain",
      "disallowLayers": ["application", "infrastructure", "presentation"],
      "severity": "error",
      "recommendation": "Keep domain models independent from frameworks and adapters."
    },
    {
      "id": "DDD-003",
      "fromLayer": "domain",
      "disallowImports": ["org.springframework.*", "typeorm", "mongoose"],
      "severity": "error",
      "recommendation": "Keep domain models independent from frameworks and persistence technology."
    }
  ],
  "ignorePaths": ["node_modules", "dist", "build", ".git"]
}
```

### Test

```bash
npm test
```

Vitest runs with the `threads` pool (`vitest run --pool=threads`).

### Troubleshooting

- `401 Missing or invalid Authorization header`
  - Check `Authorization: Bearer <token>` format.
- `403 Forbidden: Invalid token`
  - Check whether client token matches `MCP_AUTH_TOKEN`.
- `404 Session not found or inactive`
  - Reconnect to `/mcp` and retry.
- `Security Violation: Path traversal detected`
  - Use paths inside current workspace (and allowlist, if configured).

