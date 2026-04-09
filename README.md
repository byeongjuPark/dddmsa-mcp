# DDD+MSA MCP Server

![MCP Architecture](./mcp_architecture.png)

## 한국어

DDD+MSA MCP Server는 마이크로서비스 프로젝트를 위한 SSE 기반 Model Context Protocol(MCP) 서버입니다.
DDD 스캐폴딩, 아키텍처 검증, 통신 스펙 생성, 서비스 의존성 분석, 테스트 스텁 생성을 지원합니다.

### 기능

#### 제공 MCP 도구

1. `scaffold_ddd_service`
- 목적: DDD 4계층 서비스 골격 생성
- 필수 인자: `serviceName`, `targetPath`
- 선택 인자: `language` (`typescript` | `spring` | `auto`), `basePackage`, `dryRun`, `overwrite`

2. `validate_ddd_architecture`
- 목적: 계층 간 잘못된 의존성(domain/application 위반) 탐지
- 필수 인자: `targetPath`

3. `generate_communication_spec`
- 목적: 핸들러/컨트롤러를 스캔해 API 스펙 생성
- 필수 인자: `sourcePath`, `outputFormat` (`openapi` | `grpc`)
- 선택 인자: `language`, `dryRun`, `overwrite`

4. `analyze_service_dependencies`
- 목적: HTTP/Event/gRPC/인프라 의존성 추출
- 필수 인자: `targetPath`

5. `generate_test_stub`
- 목적: 소스 파일 기준 테스트 스텁 생성
- 필수 인자: `targetFilePath`
- 선택 인자: `language` (`typescript` | `spring` | `auto`), `dryRun`, `overwrite`

### 요구 사항

- Node.js 20+
- npm 10+

### 설치 및 실행

```bash
git clone https://github.com/byeongjuPark/dddmsa-msa.git
cd dddmsa-msa
npm install
npm run build
npm run start
```

개발 모드:

```bash
npm run dev
```

기본 서버 URL:

- MCP SSE 엔드포인트: `http://localhost:3001/mcp`
- 헬스 체크: `http://localhost:3001/health`

### 환경 변수

- `PORT`: HTTP 포트 (기본값: `3001`)
- `MCP_AUTH_TOKEN`: 인증 Bearer 토큰 (미설정 시 인증 비활성화)
- `RATE_LIMIT_MAX`: IP당 분당 최대 요청 수 (기본값: `100`)
- `WORKSPACE_ALLOWLIST`: 파일 작업 허용 절대 경로 목록(쉼표 구분)
- `LOG_LEVEL`: pino 로그 레벨 (기본값: `info`)
- `NODE_ENV=production`: pretty 로그 출력 비활성화

### 인증 및 보안

#### 인증 동작

- `GET /health`는 항상 공개됩니다.
- `MCP_AUTH_TOKEN`이 없으면 인증 없이 동작합니다.
- `MCP_AUTH_TOKEN`이 설정되면 `/health`를 제외한 모든 요청에
  `Authorization: Bearer <token>` 헤더가 필요합니다.

실패 응답:

- `401`: Authorization 헤더 누락/형식 오류
- `403`: 토큰 불일치

#### 요청 보호 장치

- 요청 본문 크기 제한: `1 MB` (`413 Payload Too Large`)
- Rate limit: IP당 분당 제한 (`429 Too Many Requests`)
- `resolveSafePath`를 통한 path traversal/symlink escape 방지
- `WORKSPACE_ALLOWLIST` 설정 시 허용 경로 내부만 접근 허용

### MCP 사용 방법

#### 1) MCP 클라이언트 연결

MCP 기본 URL을 등록합니다.

```json
{
  "mcpServers": {
    "dddmsa-mcp": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

인증 활성화 시 클라이언트 헤더에 다음을 포함합니다.

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

참고: 세션 메시지 엔드포인트(`/mcp/messages?sessionId=...`)는 서버 transport가 관리하므로 대부분의 클라이언트는 `/mcp`만 등록하면 됩니다.

#### 2) 코드 호출 예시 (MCP SDK)

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

#### 3) 도구 인자 예시

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

`generate_communication_spec`

```json
{
  "sourcePath": "services/order-service/src",
  "outputFormat": "openapi",
  "dryRun": true
}
```

`analyze_service_dependencies`

```json
{
  "targetPath": "services/order-service"
}
```

`generate_test_stub`

```json
{
  "targetFilePath": "src/application/useCases/createOrder.ts",
  "language": "typescript",
  "dryRun": true
}
```

### 도구 결과 형식

대부분의 도구는 `content[0].text`에 JSON 배열 형태로 결과를 반환합니다.

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

실패 시 MCP 응답에 `isError: true`가 포함됩니다.

### 테스트

```bash
npm test
```

Vitest는 `threads` pool(`vitest run --pool=threads`)로 실행됩니다.

### 트러블슈팅

- `401 Missing or invalid Authorization header`
  - `Authorization: Bearer <token>` 형식 확인
- `403 Forbidden: Invalid token`
  - 클라이언트 토큰과 `MCP_AUTH_TOKEN` 일치 여부 확인
- `404 Session not found or inactive`
  - `/mcp`로 재연결 후 재시도
- `Security Violation: Path traversal detected`
  - 워크스페이스(및 allowlist) 내부 경로만 사용

---

## English

DDD+MSA MCP Server is an SSE-based Model Context Protocol (MCP) server for microservice projects.
It provides tools for DDD scaffolding, architecture validation, communication spec generation, dependency analysis, and test stub generation.

### Features

#### Available MCP Tools

1. `scaffold_ddd_service`
- Purpose: create a DDD 4-layer service skeleton.
- Required args: `serviceName`, `targetPath`
- Optional args: `language` (`typescript` | `spring` | `auto`), `basePackage`, `dryRun`, `overwrite`

2. `validate_ddd_architecture`
- Purpose: detect invalid layer dependencies (domain/application violations).
- Required args: `targetPath`

3. `generate_communication_spec`
- Purpose: scan handlers/controllers and generate API specs.
- Required args: `sourcePath`, `outputFormat` (`openapi` | `grpc`)
- Optional args: `language`, `dryRun`, `overwrite`

4. `analyze_service_dependencies`
- Purpose: find HTTP/event/gRPC/infrastructure dependencies used by the service.
- Required args: `targetPath`

5. `generate_test_stub`
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

- MCP SSE endpoint: `http://localhost:3001/mcp`
- Health check: `http://localhost:3001/health`

### Environment Variables

- `PORT`: HTTP port (default: `3001`)
- `MCP_AUTH_TOKEN`: bearer token for authentication (if unset, auth is disabled)
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

Note: session message endpoint (`/mcp/messages?sessionId=...`) is managed by the server transport. Most clients only need `/mcp`.

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

`generate_communication_spec`

```json
{
  "sourcePath": "services/order-service/src",
  "outputFormat": "openapi",
  "dryRun": true
}
```

`analyze_service_dependencies`

```json
{
  "targetPath": "services/order-service"
}
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
