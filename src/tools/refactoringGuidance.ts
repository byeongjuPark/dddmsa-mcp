import fs from "fs/promises";
import path from "path";
import { createTwoFilesPatch } from "diff";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";

interface ExplainArgs {
  finding: ToolResult;
}

interface RefactoringPlanArgs {
  finding: ToolResult;
  targetPath?: string;
  dryRun?: boolean;
}

interface RefactoringGuidance {
  ruleId: string;
  title: string;
  impact: string;
  cause: string;
  preferredFix: string;
  steps: string[];
  verification: string[];
  patchPreview?: string;
}

const RULE_GUIDANCE: Record<string, Omit<RefactoringGuidance, "ruleId" | "patchPreview">> = {
  "DDD-001": {
    title: "Domain layer depends on an outer layer",
    impact: "The domain model becomes coupled to orchestration, infrastructure, or delivery concerns.",
    cause: "A domain file imports a module that belongs to application, infrastructure, or presentation.",
    preferredFix: "Introduce a domain concept or application port so the domain does not import outward.",
    steps: [
      "Identify the imported outer-layer type and why the domain needs it.",
      "Move behavior that talks to infrastructure or presentation into application/infrastructure code.",
      "Keep only domain-owned types, value objects, interfaces, or primitives in the domain file.",
    ],
    verification: ["Run validate_ddd_architecture again.", "Run tests around the changed use case or domain behavior."],
  },
  "DDD-002": {
    title: "Application layer depends on infrastructure or presentation",
    impact: "Use cases become difficult to test and cannot be reused without concrete adapters.",
    cause: "Application code imports infrastructure or presentation directly.",
    preferredFix: "Define an application port/interface and inject an infrastructure implementation from the composition root.",
    steps: [
      "Create an application-level interface for the behavior needed by the use case.",
      "Move concrete adapter usage into infrastructure or composition code.",
      "Update the use case to depend on the interface.",
    ],
    verification: ["Run validate_ddd_architecture again.", "Add or update a use case test with a fake port implementation."],
  },
  "DDD-003": {
    title: "Domain layer leaks framework or persistence concerns",
    impact: "Domain code becomes tied to a framework, ORM, or transport library.",
    cause: "A domain file imports framework or persistence packages such as Spring, TypeORM, Mongoose, or Express.",
    preferredFix: "Move framework annotations/configuration to an adapter or persistence model and map to pure domain objects.",
    steps: [
      "Separate the pure domain model from persistence or transport models.",
      "Move decorators/annotations and framework imports into infrastructure.",
      "Add a mapper between infrastructure records and domain objects.",
    ],
    verification: ["Run validate_ddd_architecture again.", "Run persistence adapter tests and domain unit tests separately."],
  },
  "DDD-004": {
    title: "Presentation layer accesses repository or infrastructure directly",
    impact: "Controllers bypass application use cases and spread business workflow across delivery code.",
    cause: "Presentation code imports infrastructure or repository code directly.",
    preferredFix: "Route the controller through an application use case and keep repository access behind that use case.",
    steps: [
      "Create or locate the application use case for this request.",
      "Inject the use case into the controller instead of a repository.",
      "Move repository calls into the application/infrastructure boundary.",
    ],
    verification: ["Run validate_ddd_architecture again.", "Add controller tests that mock the use case, not the repository."],
  },
  "MSA-001": {
    title: "Bounded context imports another context's entity",
    impact: "Contexts become tightly coupled and changes to one domain model ripple into another service/context.",
    cause: "A domain file imports an entity from another bounded context or service.",
    preferredFix: "Depend on IDs, contracts, events, or anti-corruption-layer DTOs instead of foreign entities.",
    steps: [
      "Replace the foreign entity type with an ID or local value object.",
      "Create a contract/DTO for data crossing the context boundary.",
      "Map external data into local domain concepts at the application boundary.",
    ],
    verification: ["Run validate_ddd_architecture again.", "Add contract mapping tests at the boundary."],
  },
  "MSA-DB-SHARED": {
    title: "Database resource appears shared across services",
    impact: "Services can become coupled through database schema ownership instead of explicit contracts.",
    cause: "The same database driver/model/repository signal appears under multiple service directories.",
    preferredFix: "Assign database ownership to one service and expose changes through APIs, events, or read models.",
    steps: [
      "Confirm whether the reported resource is truly the same schema/table/collection.",
      "Choose one owning service for writes.",
      "Replace direct access in other services with an API, event subscription, or replicated read model.",
    ],
    verification: ["Run analyze_service_dependencies again.", "Add integration tests around the replacement contract."],
  },
  "DEP-GRAPH-CYCLE": {
    title: "Service dependency cycle detected",
    impact: "Bidirectional runtime calls make releases, failures, and data ownership harder to isolate.",
    cause: "The service graph contains a cycle through synchronous HTTP or gRPC dependencies.",
    preferredFix: "Break the cycle by choosing one owning service and replacing the reverse call with an event, read model, or explicit contract.",
    steps: [
      "Identify the business workflow that requires both directions of communication.",
      "Choose the service that owns the state transition or decision.",
      "Replace the reverse synchronous call with an integration event, query projection, or application-level orchestration.",
    ],
    verification: ["Run analyze_service_dependencies again.", "Add integration or contract tests for the new one-way interaction."],
  },
  "DEP-GRAPH-HOTSPOT": {
    title: "High service coupling hotspot",
    impact: "A highly connected service can become a distributed monolith hub or a release bottleneck.",
    cause: "The service graph shows unusually high incoming or outgoing service dependencies.",
    preferredFix: "Review whether the service boundary is too broad, too central, or missing stable integration contracts.",
    steps: [
      "List the responsibilities behind each reported dependency.",
      "Separate orchestration from domain ownership where those concerns are mixed.",
      "Introduce stable contracts, events, or read models for dependencies that do not need request-time coupling.",
    ],
    verification: ["Run analyze_service_dependencies again.", "Run contract tests for dependencies whose integration style changed."],
  },
  "DEP-ANALYSIS-WARN": {
    title: "Dependency analysis warning",
    impact: "Dependency findings may be incomplete because one or more files/directories could not be analyzed.",
    cause: "A parser or directory traversal warning occurred during analysis.",
    preferredFix: "Inspect the warning evidence and fix unsupported syntax, unreadable files, or unexpected directory access errors.",
    steps: [
      "Read each warning evidence message.",
      "Confirm whether the skipped file or directory matters for architecture analysis.",
      "Fix the parser input or exclude irrelevant generated paths from analysis.",
    ],
    verification: ["Run analyze_service_dependencies again.", "Confirm DEP-ANALYSIS-WARN no longer appears or is intentionally ignored."],
  },
};

export async function explainArchitectureViolation(args: ExplainArgs) {
  const guidance = buildGuidance(args.finding);

  return {
    content: [{ type: "text", text: JSON.stringify(guidance, null, 2) }],
  };
}

export async function suggestRefactoringPlan(args: RefactoringPlanArgs) {
  const guidance = buildGuidance(args.finding);
  const targetPath = args.targetPath ?? ".";

  if (args.dryRun) {
    guidance.patchPreview = await buildPatchPreview(targetPath, args.finding, guidance);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(guidance, null, 2) }],
  };
}

function buildGuidance(finding: ToolResult): RefactoringGuidance {
  const base = RULE_GUIDANCE[finding.ruleId] ?? {
    title: "Architecture finding",
    impact: "The finding indicates an architecture rule violation or dependency risk.",
    cause: finding.evidence[0]?.message ?? "No evidence message was provided.",
    preferredFix: finding.recommendation ?? "Inspect the evidence and move the dependency behind an explicit boundary.",
    steps: [
      "Read the evidence file and identify the dependency direction.",
      "Move the dependency behind the correct layer or service boundary.",
      "Re-run the relevant MCP analysis tool.",
    ],
    verification: ["Run npm test.", "Run the originating analysis tool again."],
  };

  return {
    ruleId: finding.ruleId,
    title: base.title,
    impact: base.impact,
    cause: `${base.cause} Evidence: ${formatEvidence(finding)}`,
    preferredFix: finding.recommendation ?? base.preferredFix,
    steps: base.steps,
    verification: base.verification,
  };
}

async function buildPatchPreview(targetPath: string, finding: ToolResult, guidance: RefactoringGuidance): Promise<string> {
  const firstFile = finding.evidence[0]?.file;
  if (!firstFile) {
    return "No evidence file was provided, so no patch preview can be generated.";
  }

  try {
    const rootDir = resolveSafePath(process.cwd(), targetPath);
    const fullPath = resolveSafePath(rootDir, firstFile);
    const existingContent = await fs.readFile(fullPath, "utf-8");
    const previewContent = `${existingContent.trimEnd()}\n\n/*\nRefactoring plan (${finding.ruleId}):\n${guidance.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n*/\n`;

    return createTwoFilesPatch(
      path.basename(firstFile),
      path.basename(firstFile),
      existingContent,
      previewContent,
      "current",
      "refactoring-plan-preview"
    );
  } catch (error: any) {
    return `Patch preview unavailable: ${error.message}`;
  }
}

function formatEvidence(finding: ToolResult): string {
  if (finding.evidence.length === 0) {
    return "No evidence was provided.";
  }

  return finding.evidence
    .map((evidence) => `${evidence.file}${evidence.line ? `:${evidence.line}` : ""} - ${evidence.message ?? "no message"}`)
    .join("; ");
}
