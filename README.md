# DDD+MSA MCP Server

![MCP Architecture](./mcp_architecture.png)

## 한국어

**DDD+MSA MCP Server**는 마이크로서비스(MSA) 개발에서 도메인 주도 설계(DDD) 구조를 빠르게 적용하고, 아키텍처 위반을 점검할 수 있도록 만든 **Model Context Protocol (MCP) 서버**입니다.  
Node.js(TypeScript)와 Spring Boot(Java/Kotlin) 프로젝트를 대상으로 동작합니다.

Cursor, Claude Desktop 등 MCP 클라이언트에 연결하면 AI가 툴을 직접 호출해 스캐폴딩/검증/분석 작업을 자동으로 수행할 수 있습니다.

### 주요 기능 (Tools)

- **`scaffold_ddd_service`**  
  신규 마이크로서비스에 DDD 4계층(`domain`, `application`, `infrastructure`, `presentation`) 기본 구조를 생성합니다.
- **`validate_ddd_architecture`**  
  계층 간 의존성 위반(예: domain -> infrastructure 참조)을 검사합니다.
- **`generate_communication_spec`**  
  컨트롤러/핸들러를 스캔해 OpenAPI(JSON) 또는 gRPC(proto) 스펙 초안을 생성합니다.
- **`analyze_service_dependencies`**  
  코드 내 HTTP/Event 연동 지점을 스캔해 외부 서비스 의존성을 보고합니다.
- **`generate_test_stub`**  
  대상 소스 파일 기준으로 테스트 스텁 파일을 생성합니다.

### 설치 및 실행

1. **저장소 클론 및 종속성 설치**

```bash
git clone https://github.com/byeongjuPark/dddmsa-mcp.git
cd dddmsa-mcp
npm install
```

2. 빌드

```bash
npm run build
```

3. 서버 실행

```bash
npm run start
```

기본 MCP 엔드포인트는 `http://localhost:3001/mcp` 입니다.

### MCP 클라이언트 연동 예시

```json
{
  "mcpServers": {
    "dddmsa-mcp": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

참고:
- 서버는 SSE 기반으로 동작합니다.
- 세션별 메시지 엔드포인트(`/mcp/messages?sessionId=...`)는 서버가 자동으로 안내하므로 클라이언트는 `/mcp`만 등록하면 됩니다.

### 테스트

```bash
npm test
```

현재 테스트는 Vitest `threads` 풀로 실행되도록 설정되어 있습니다.

### 최근 변경사항

- MCP 세션 라우팅을 SDK `transport.sessionId` 기준으로 정렬해 `listTools/callTool` 연동 안정성 개선
- `analyze_service_dependencies` 경로 안전성 강화(경로 탈출 방지)
- `validate_ddd_architecture`의 디렉터리 접근/오류 보고 보강
- MCP SSE 통합 테스트 및 경로 보안 테스트 추가

---

# DDD+MSA MCP Server (English)

The **DDD+MSA MCP Server** is a **Model Context Protocol (MCP)** server that helps teams apply Domain-Driven Design (DDD) patterns and validate architecture rules in microservice projects.  
It targets both Node.js (TypeScript) and Spring Boot (Java/Kotlin) codebases.

When connected to MCP-capable clients such as Cursor or Claude Desktop, AI can call these tools directly for scaffolding, validation, and dependency analysis.

## Key Tools

- **`scaffold_ddd_service`**  
  Generates a DDD 4-layer service skeleton (`domain`, `application`, `infrastructure`, `presentation`).
- **`validate_ddd_architecture`**  
  Detects layer dependency violations (for example, domain -> infrastructure imports).
- **`generate_communication_spec`**  
  Scans handlers/controllers and generates OpenAPI (JSON) or gRPC (proto) drafts.
- **`analyze_service_dependencies`**  
  Scans HTTP/Event integration points and reports external service dependencies.
- **`generate_test_stub`**  
  Generates a test stub file for a target source file.

## Installation & Run

1. **Clone the repository and install dependencies:**

```bash
git clone https://github.com/byeongjuPark/dddmsa-mcp.git
cd dddmsa-mcp
npm install
```

2. Build

```bash
npm run build
```

3. Start server

```bash
npm run start
```

Default MCP endpoint: `http://localhost:3001/mcp`

## MCP Client Config Example

```json
{
  "mcpServers": {
    "dddmsa-mcp": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Notes:
- The server runs over SSE.
- Per-session message URLs (`/mcp/messages?sessionId=...`) are provided automatically by the server. Clients only need `/mcp`.

## Test

```bash
npm test
```

Tests are configured to run with the Vitest `threads` pool.

## Recent Updates

- Fixed MCP session routing by aligning with SDK `transport.sessionId` for stable `listTools/callTool`
- Hardened path safety in `analyze_service_dependencies` (path traversal protection)
- Improved directory access/error reporting in `validate_ddd_architecture`
- Added MCP SSE integration tests and path safety tests
