# DDD+MSA MCP Server

![MCP Architecture](./mcp_architecture.png)

**DDD+MSA MCP Server**는 팀원들이 마이크로서비스(MSA)를 개발할 때 도메인 주도 설계(DDD) 아키텍처 규칙과 통신 규격을 쉽게 준수할 수 있도록 돕는 **Model Context Protocol (MCP)** 서버입니다. 오픈소스로 설계되어 Node.js(TypeScript) 환경은 물론 Spring Boot(Java/Kotlin) 생태계까지 모두 자동으로 인식하여 동작합니다.

Cursor IDE, Claude Desktop 등 MCP 규격을 지원하는 AI 어시스턴트에 이 도구를 등록하시면, AI가 알아서 프로젝트 구조를 잡아주고 아키텍처 위반을 검사해줍니다.

## 주요 기능 (Tools)

- **`scaffold_ddd_service`**: 새로운 마이크로서비스를 시작할 때 표준 DDD 4계층(`domain`, `application`, `infrastructure`, `presentation`) 아키텍처 디렉터리 폴더와 보일러플레이트를 생성합니다. (현재 작업 중인 폴더의 `package.json`이나 `build.gradle`을 인식해 Spring Boot, Node 환경을 알아서 유추합니다.)
- **`validate_ddd_architecture`**: 도메인(Domain) 계층이 실수로 인프라스트럭처나 인터페이스 계층을 참조하지 않았는지 등 역방향 의존성 위반 여부를 검사합니다. (.ts, .js, .java, .kt 파일 완벽 지원)
- `generate_communication_spec`: 작성된 서비스의 API 문서를 바탕으로 타 서비스 통신간 사용할 명세(OpenAPI JSON, gRPC proto)의 형태를 자동 생성해 줍니다.
- `analyze_service_dependencies`: 코드 내의 HTTP(`axios`, `fetch`, `RestTemplate`, `FeignClient`) 또는 Event(`Kafka`, `RabbitMQ`) 패턴을 스캔해 대상 모듈이 외부의 어떤 서비스에 의존성을 가지고 있는지 출력해줍니다.
- **`generate_test_stub`**: 소스 코드를 바탕으로 정확한 경로 설정과 함께 테스트 코드 보일러플레이트(Test Stub)를 자동 생성하여 AI가 즉각적으로 테스트 코드를 작성할 수 있는 기틀을 마련해줍니다.

## 설치 및 실행 방법

1. **저장소 클론 및 종속성 설치**
   ```bash
   git clone <repository_url>
   cd dddmsa-mcp
   npm install
   ```

2. **프로젝트 빌드**
   ```bash
   npm run build
3. **독립 서버 실행**
   ```bash
   npm run start
   ```
   실행 시 기본 포트는 `3001`번이며, URL은 `http://localhost:3001/mcp` 로 생성됩니다.

4. **바이브코딩(Vibe Coding) 및 AI IDE 연동 (JSON 등록)**
   서버가 백그라운드에 띄워진 상태에서, 각 AI 클라이언트의 MCP 설정 탭에 JSON 형태로 **SSE 방식** 엔드포인트를 등록합니다.
   ```json
   {
     "mcpServers": {
       "dddmsa-mcp": {
         "url": "http://localhost:3001/mcp"
       }
     }
   }
   ```
   *주의: IDE마다 SSE 연동을 지원하는 UI/JSON 구조가 다를 수 있습니다. 설정에서 `sse` 방식 혹은 `http` 엔드포인트를 제공하도록 지정해주세요.*
   등록이 완료되면, 채팅창에서 *"결제 서비스 DDD 구조로 스캐폴딩해줘"*, *"현재 프로젝트 의존성 분석해줘"* 처럼 명령을 내릴 수 있습니다!

---

# DDD+MSA MCP Server (English)

The **DDD+MSA MCP Server** is a **Model Context Protocol (MCP)** server designed to help teams easily adhere to Domain-Driven Design (DDD) architectural rules and communication specifications when developing Microservices (MSA). Built globally for open-source friendliness, it intelligently detects and supports both Node.js (TypeScript) and Spring Boot (Java/Kotlin) ecosystems seamlessly.

By integrating this tool into MCP-compatible AI assistants like Cursor IDE or Claude Desktop, your AI buddy can automatically scaffold your project structures and enforce architecture guardrails on the fly.

## Key Tools & Features

- **`scaffold_ddd_service`**: Auto-generates the foundational boilerplate and strict 4-layer DDD directory structures (`domain`, `application`, `infrastructure`, `presentation`) for a new microservice. (It dynamically senses `package.json` or `build.gradle` to cater to Spring Boot or Node environments.)
- **`validate_ddd_architecture`**: Ensures structural integrity by checking for inverse dependency violations (e.g., verifying that the Domain layer does not mistakenly import the Infrastructure layer). Works flawlessly on `.ts`, `.js`, `.java`, and `.kt` files.
- `generate_communication_spec`: Scans your service's controllers/handlers to automatically draft communication specifications like OpenAPI (JSON) or gRPC proto models.
- `analyze_service_dependencies`: Scans the source code for HTTP calls (e.g. `axios`, `fetch`, `RestTemplate`, `FeignClient`) and Event emissions (e.g. `Kafka`, `RabbitMQ`) to generate a detailed report of all external services your module is depending on.
- **`generate_test_stub`**: Creates boilerplate test stubs with accurate path-matching (e.g., mapping `src/main/java` to `src/test/java`). This provides an immediate foundation for your AI to write full mock setups and test cases seamlessly.

## Installation & Quick Start

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repository_url>
   cd dddmsa-mcp
   npm install
   ```

2. **Build the typescript project:**
   ```bash
   npm run build
3. **Start the local server:**
   ```bash
   npm run start
   ```
   The server will bind to `http://localhost:3001/mcp` by default.

4. **Integrate with Vibe Coding / AI Assistants (JSON config):**
   In your AI Client's MCP configuration JSON or settings UI, add the **SSE endpoint** URL.
   ```json
   {
     "mcpServers": {
       "dddmsa-mcp": {
         "url": "http://localhost:3001/mcp"
       }
     }
   }
   ```
   *Note: Ensure your IDE supports SSE (Server-Sent Events) for MCP. Configure it to read from the provided HTTP endpoint rather than stdio.*
   Once connected, you can simply ask the AI prompt: *"Scaffold a billing service using DDD architecture,"* or *"Analyze my microservice dependencies!"*
