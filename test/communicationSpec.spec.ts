import { describe, expect, it } from "vitest";
import path from "path";
import { generateCommunicationSpec } from "../src/tools/generateCommunicationSpec.js";

describe("generateCommunicationSpec", () => {
  it("generates OpenAPI schemas from TypeScript DTO signatures with source lines", async () => {
    const result = await generateCommunicationSpec({
      sourcePath: path.join("test", "fixtures", "communication-spec"),
      outputFormat: "openapi",
      dryRun: true,
    });

    expect(result.isError).toBeFalsy();
    const findings = JSON.parse(result.content[0].text);
    const dryRunMessage = findings[0].evidence[0].message;

    expect(dryRunMessage).toContain('"CreateOrderRequest"');
    expect(dryRunMessage).toContain('"OrderResponse"');
    expect(dryRunMessage).toContain('"requestBody"');
    expect(dryRunMessage).toContain('"x-source"');
    expect(dryRunMessage).toContain('"line"');
    expect(dryRunMessage).toContain('"priority"');
  });
});
