import { describe, expect, it } from "vitest";
import { explainArchitectureViolation, suggestRefactoringPlan } from "../src/tools/refactoringGuidance.js";

const finding = {
  ruleId: "DDD-004",
  confidence: 1,
  errorCode: "DEPENDENCY_VIOLATION",
  evidence: [
    {
      file: "test/fixtures/advanced-rules/presentation/orderController.ts",
      message: "presentation layer violates disallowed infrastructure layer via ../infrastructure/sqlOrderRepository",
    },
  ],
};

describe("refactoring guidance tools", () => {
  it("explains an architecture violation", async () => {
    const result = await explainArchitectureViolation({ finding });
    const explanation = JSON.parse(result.content[0].text);

    expect(explanation.ruleId).toBe("DDD-004");
    expect(explanation.title).toContain("Presentation");
    expect(explanation.steps.length).toBeGreaterThan(0);
  });

  it("returns a dry-run patch preview for an evidence file", async () => {
    const result = await suggestRefactoringPlan({
      finding,
      targetPath: ".",
      dryRun: true,
    });
    const plan = JSON.parse(result.content[0].text);

    expect(plan.ruleId).toBe("DDD-004");
    expect(plan.patchPreview).toContain("Refactoring plan");
    expect(plan.verification).toContain("Run validate_ddd_architecture again.");
  });

  it("explains service graph cycles", async () => {
    const result = await explainArchitectureViolation({
      finding: {
        ruleId: "DEP-GRAPH-CYCLE",
        confidence: 0.85,
        errorCode: "SERVICE_DEPENDENCY_CYCLE",
        evidence: [
          { file: "services", message: "Service cycle member: order-service" },
          { file: "services", message: "Service cycle member: billing-service" },
        ],
      },
    });
    const explanation = JSON.parse(result.content[0].text);

    expect(explanation.title).toContain("Service dependency cycle");
    expect(explanation.preferredFix).toContain("Break the cycle");
    expect(explanation.verification).toContain("Run analyze_service_dependencies again.");
  });
});
