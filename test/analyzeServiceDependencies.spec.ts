import { describe, expect, it } from "vitest";
import { analyzeServiceDependencies } from "../src/tools/analyzeServiceDependencies.js";

describe("analyzeServiceDependencies", () => {
  it("rejects path traversal", async () => {
    const result = await analyzeServiceDependencies({ targetPath: "../" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("Path traversal");
  });
});
