# DDD+MSA MCP Refactor TODO

## Goal

Move this project from a set of code-generation helpers toward an MCP server that can understand a workspace, reason about DDD/MSA architecture, and guide safe changes.

## Phase 1: Project Understanding

- [x] Add `inspect_workspace` to build a project model from the current workspace.
- [x] Detect language, build tool, framework hints, source roots, DDD layers, controllers, repositories, and dependency signals.
- [x] Return a structured workspace model instead of free-form summaries.
- [x] Add fixture tests for TypeScript and Spring-style projects.

## Phase 2: Transport Modernization

- [x] Add Streamable HTTP support on `/mcp` as the primary transport.
- [x] Keep HTTP+SSE endpoints for older MCP clients.
- [x] Add Origin validation for HTTP transports.
- [x] Add integration tests for both Streamable HTTP and legacy SSE.

## Phase 3: Rule Engine

- [x] Add `.dddmsa.json` configuration support.
- [x] Move hard-coded architecture checks into versioned rules.
- [x] Support rule severity, layer aliases, and ignored paths.
- [x] Add rules for domain framework leakage, presentation-to-repository access, and cross-context entity imports.
- [x] Add direct database sharing detection.

## Phase 4: Actionable Refactoring

- [x] Add `explain_architecture_violation`.
- [x] Add `suggest_refactoring_plan`.
- [x] Add dry-run patch preview generation for safe architecture fixes.
- [x] Return diffs and required follow-up tests before writing files.

## Phase 5: Spec and Dependency Graph Quality

- [x] Generate OpenAPI schemas from request/response DTOs.
- [x] Extract Java annotations and TypeScript handler signatures with line numbers.
- [x] Promote dependency analysis with shared database resource detection.
- [x] Promote dependency analysis to a full service graph with sync/async classification.
- [x] Detect circular dependencies and high-coupling hotspots.
