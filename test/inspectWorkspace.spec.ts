import { describe, expect, it } from "vitest";
import path from "path";
import { inspectWorkspace } from "../src/tools/inspectWorkspace.js";

describe("inspectWorkspace", () => {
  it("builds a project model for a TypeScript fixture", async () => {
    const result = await inspectWorkspace({
      targetPath: path.join("test", "fixtures", "typescript-mock"),
    });

    expect(result.isError).toBeFalsy();
    const model = JSON.parse(result.content[0].text);

    expect(model.ecosystems).toContain("typescript");
    expect(model.dependencySignals.some((signal: any) => signal.message.includes("axios"))).toBe(true);
    expect(model.dependencySignals.some((signal: any) => signal.message.includes("USER_CREATED"))).toBe(true);
  });

  it("builds a project model for a Java fixture", async () => {
    const result = await inspectWorkspace({
      targetPath: path.join("test", "fixtures", "java-mock"),
    });

    expect(result.isError).toBeFalsy();
    const model = JSON.parse(result.content[0].text);

    expect(model.ecosystems).toContain("spring");
    expect(model.entrypoints.some((entrypoint: any) => entrypoint.message.includes("Spring endpoint"))).toBe(true);
    expect(model.dependencySignals.some((signal: any) => signal.message.includes("HTTP API"))).toBe(true);
  });
});

