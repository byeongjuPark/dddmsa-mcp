import { describe, expect, it } from "vitest";
import path from "path";
import { validateDddArchitecture } from "../src/tools/validateDddArchitecture.js";

describe("validateDddArchitecture", () => {
  it("detects default DDD layer dependency violations", async () => {
    const result = await validateDddArchitecture({
      targetPath: path.join("test", "fixtures", "ddd-violation"),
    });

    expect(result.isError).toBeFalsy();
    const findings = JSON.parse(result.content[0].text);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("DDD-001");
    expect(findings[0].errorCode).toBe("DEPENDENCY_VIOLATION");
  });

  it("supports .dddmsa.json layer aliases and custom rules", async () => {
    const result = await validateDddArchitecture({
      targetPath: path.join("test", "fixtures", "custom-rules"),
    });

    expect(result.isError).toBeFalsy();
    const findings = JSON.parse(result.content[0].text);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("CUSTOM-001");
    expect(findings[0].recommendation).toContain("core model");
  });

  it("detects advanced default architecture rules", async () => {
    const result = await validateDddArchitecture({
      targetPath: path.join("test", "fixtures", "advanced-rules"),
    });

    expect(result.isError).toBeFalsy();
    const findings = JSON.parse(result.content[0].text);
    const ruleIds = findings.map((finding: any) => finding.ruleId);

    expect(ruleIds).toContain("DDD-003");
    expect(ruleIds).toContain("DDD-004");
    expect(ruleIds).toContain("MSA-001");
  });
});
