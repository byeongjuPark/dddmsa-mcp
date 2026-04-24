import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";
import { extractJavaDataFromAST } from "../utils/javaCstWalker.js";
import {
  ArchitectureConfig,
  findImportLayer,
  getLayerForPath,
  loadArchitectureConfig,
  matchesAnyPattern,
  shouldIgnorePath,
} from "../utils/architectureRules.js";

interface ValidateArgs {
  targetPath: string;
}

export async function validateDddArchitecture(args: ValidateArgs) {
  const { targetPath } = args;
  const rootDir = resolveSafePath(process.cwd(), targetPath);
  const results: ToolResult[] = [];
  const errors: string[] = [];

  try {
    await fs.access(rootDir);
    const config = await loadArchitectureConfig(rootDir);

    async function walk(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(rootDir, fullPath);

          if (shouldIgnorePath(relativePath, config)) {
            continue;
          }

          if (entry.isDirectory()) {
            await walk(fullPath);
            continue;
          }

          if (!entry.isFile() || !isSupportedSource(entry.name)) {
            continue;
          }

          const sourceLayer = getLayerForPath(relativePath, config);
          if (!sourceLayer) {
            continue;
          }

          try {
            const imports = await extractImports(fullPath, entry.name);
            for (const importPath of imports) {
              const resolvedImportPath = resolveImportPath(relativePath, importPath);
              checkRules(relativePath, sourceLayer, importPath, resolvedImportPath, config);
            }
          } catch (error: any) {
            errors.push(`Failed to inspect ${relativePath}: ${error.message}`);
          }
        }
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          errors.push(`Error walking directory ${dir}: ${error.message}`);
        }
      }
    }

    function checkRules(
      relativePath: string,
      sourceLayer: string,
      importPath: string,
      resolvedImportPath: string,
      config: ArchitectureConfig
    ) {
      const targetLayer = findImportLayer(resolvedImportPath, config) ?? findImportLayer(importPath, config);

      for (const rule of config.rules) {
        if (rule.fromLayer !== sourceLayer) {
          continue;
        }

        const hasLayerViolation = targetLayer !== undefined && (rule.disallowLayers ?? []).includes(targetLayer);
        const hasImportViolation = matchesAnyPattern(importPath, rule.disallowImports);
        const hasPathViolation = matchesAnyPattern(resolvedImportPath, rule.disallowPathPatterns);

        if (!hasLayerViolation && !hasImportViolation && !hasPathViolation) {
          continue;
        }

        const reason = [
          hasLayerViolation && targetLayer ? `disallowed ${targetLayer} layer` : undefined,
          hasImportViolation ? `disallowed import pattern` : undefined,
          hasPathViolation ? `disallowed path pattern` : undefined,
        ].filter(Boolean).join(", ");

        results.push({
          ruleId: rule.id,
          confidence: 1.0,
          evidence: [
            {
              file: relativePath,
              message: `${sourceLayer} layer violates ${reason} via ${importPath}`,
            },
          ],
          errorCode: rule.severity === "error" ? "DEPENDENCY_VIOLATION" : "DEPENDENCY_WARNING",
          recommendation: rule.recommendation,
        });
      }
    }

    await walk(rootDir);

    if (errors.length > 0) {
      results.push({
        ruleId: "ARCH-INSPECT-ERR",
        confidence: 1.0,
        evidence: errors.map((error) => ({ file: targetPath, message: error })),
        errorCode: "PARSE_ERROR",
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  } catch (error: any) {
    const errorResults: ToolResult[] = [
      {
        ruleId: "VAL-FAIL",
        confidence: 0,
        errorCode: "VAL_ERR",
        evidence: [{ file: targetPath, message: error.message }],
      },
    ];
    return {
      content: [{ type: "text", text: JSON.stringify(errorResults, null, 2) }],
      isError: true,
    };
  }
}

function resolveImportPath(relativeFilePath: string, importPath: string): string {
  if (!importPath.startsWith(".")) {
    return importPath;
  }

  return path.normalize(path.join(path.dirname(relativeFilePath), importPath)).replace(/\\/g, "/");
}

function isSupportedSource(fileName: string): boolean {
  return [".ts", ".js", ".java", ".kt"].includes(path.extname(fileName));
}

async function extractImports(fullPath: string, fileName: string): Promise<string[]> {
  const content = await fs.readFile(fullPath, "utf-8");
  const extension = path.extname(fileName);

  if (extension === ".ts" || extension === ".js") {
    const imports: string[] = [];
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);

    ts.forEachChild(sourceFile, function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.push(arg.text);
        }
      }

      ts.forEachChild(node, visit);
    });

    return imports;
  }

  const extraction = extractJavaDataFromAST(content);
  return extraction.imports;
}
