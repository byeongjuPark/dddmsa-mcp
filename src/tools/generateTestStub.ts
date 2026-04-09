import fs from "fs/promises";
import path from "path";
import * as Diff from "diff";
import { resolveSafePath } from "../utils/pathUtils.js";

interface GenerateTestArgs {
  targetFilePath: string;
  language?: "typescript" | "spring" | "auto";
  dryRun?: boolean;
  overwrite?: boolean;
}

async function detectLanguage(targetFilePath: string): Promise<"typescript" | "spring"> {
  const ext = path.extname(targetFilePath);
  if (ext === ".java" || ext === ".kt") return "spring";
  return "typescript";
}

export async function generateTestStub(args: GenerateTestArgs) {
  let { targetFilePath, language = "auto", dryRun = false, overwrite = false } = args;

  try {
    const fullSourcePath = resolveSafePath(process.cwd(), targetFilePath);
    
    // Check if source file exists
    try {
      await fs.access(fullSourcePath);
    } catch {
      throw new Error(`Target file does not exist: ${targetFilePath}`);
    }

    if (language === "auto") {
      language = await detectLanguage(targetFilePath);
    }

    const { dir, name, ext } = path.parse(targetFilePath);
    let testFilePath = "";
    let testContent = "";

    if (language === "spring") {
      // Spring structure: replace src/main/java with src/test/java
      const normalizedPath = targetFilePath.replace(/\\/g, '/');
      testFilePath = normalizedPath.replace('src/main/java', 'src/test/java');
      // If it doesn't have src/main/java, just append Test
      if (testFilePath === normalizedPath) {
        testFilePath = path.join(dir, `${name}Test${ext}`);
      } else {
        const parsedNode = path.parse(testFilePath);
        testFilePath = path.join(parsedNode.dir, `${parsedNode.name}Test${parsedNode.ext}`);
      }

      // Extract package name from the original file to put in the test file
      const sourceCode = await fs.readFile(fullSourcePath, "utf-8");
      const pkgMatch = sourceCode.match(/package\s+([^;]+);/);
      const pkgDecl = pkgMatch ? `package ${pkgMatch[1]};\n\n` : "";

      testContent = `${pkgDecl}import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(MockitoExtension.class)
class ${name}Test {

    // TODO: The AI should fill in the actual test implementation below
    
    @Test
    void testStandardBehavior() {
        // given
        // when
        // then
    }
}
`;

    } else {
      // TypeScript/Node structure
      // Usually next to the file or in a __tests__ folder
      testFilePath = path.join(dir, `${name}.spec${ext}`);
      
      const className = name.charAt(0).toUpperCase() + name.slice(1);
      
      testContent = `import { describe, it, expect, beforeEach, vi } from 'vitest';
// import { ${className} } from './${name}';

describe('${className}', () => {
  beforeEach(() => {
    // Setup before each test
    vi.clearAllMocks();
  });

  it('should behave according to standard specifications', () => {
    // given
    // when
    // then
    expect(true).toBe(true); // TODO: The AI should implement actual test logic
  });
});
`;
    }

    const fullTestPath = resolveSafePath(process.cwd(), testFilePath);

    let existingContent = "";
    try {
      existingContent = await fs.readFile(fullTestPath, "utf-8");
      if (!overwrite) {
        throw new Error(`Test file already exists at ${testFilePath}. Pass 'overwrite: true' to force.`);
      }
    } catch (e: any) {
      if (e.message.includes('already exists')) throw e;
    }

    if (dryRun) {
      let diffStr = "";
      if (existingContent) {
        const patch = Diff.createTwoFilesPatch(testFilePath, testFilePath, existingContent, testContent, "Existing", "New");
        diffStr = `[DRY RUN] Diff of modifications to ${testFilePath}:\n\n${patch}`;
      } else {
        diffStr = `[DRY RUN] Would create ${testFilePath} with the following content:\n\n${testContent}`;
      }
      return {
        content: [{ type: "text", text: diffStr }]
      };
    }
    
    // Create necessary directories for the test file
    await fs.mkdir(path.dirname(fullTestPath), { recursive: true });

    // Write the test stub
    await fs.writeFile(fullTestPath, testContent);

    return {
      content: [
        {
          type: "text",
          text: `✅ Successfully generated test stub at: ${testFilePath}\n\nAI Assistant: Please read this generated file and implement the actual mock setup and test logic according to the source file.`,
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to generate test stub: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
