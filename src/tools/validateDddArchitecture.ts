import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";

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

    // Regex for Java/Kotlin imports
    const javaImportRegex = /import\s+(.*?);?/g;

    async function walk(dir: string, layer: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath, layer);
          } else {
            const isTS = entry.name.endsWith('.ts') || entry.name.endsWith('.js');
            const isJava = entry.name.endsWith('.java') || entry.name.endsWith('.kt');

            if (isTS || isJava) {
              try {
                const content = await fs.readFile(fullPath, "utf-8");
                
                if (isTS) {
                  const sourceFile = ts.createSourceFile(
                    fullPath,
                    content,
                    ts.ScriptTarget.Latest,
                    true
                  );

                  function extractImports(node: ts.Node) {
                    if (ts.isImportDeclaration(node)) {
                      const moduleSpecifier = node.moduleSpecifier;
                      if (ts.isStringLiteral(moduleSpecifier)) {
                        checkViolation(fullPath, moduleSpecifier.text, layer, "application", "infrastructure", "presentation");
                      }
                    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                      const arg = node.arguments[0];
                      if (arg && ts.isStringLiteral(arg)) {
                        checkViolation(fullPath, arg.text, layer, "application", "infrastructure", "presentation");
                      }
                    }
                    ts.forEachChild(node, extractImports);
                  }

                  extractImports(sourceFile);
                }
                
                if (isJava) {
                  let match;
                  while ((match = javaImportRegex.exec(content)) !== null) {
                    const importPath = match[1];
                    checkViolation(fullPath, importPath, layer, ".application.", ".infrastructure.", ".presentation.");
                  }
                }
              } catch (err: any) {
                errors.push(`Error reading file ${fullPath}: ${err.message}`);
              }
            }
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          errors.push(`Error walking directory ${dir}: ${err.message}`);
        }
      }
    }

    function checkViolation(fullPath: string, importPath: string, layer: string, appKey: string, infraKey: string, presKey: string) {
      if (layer === "domain") {
        if (importPath.includes(appKey) || importPath.includes(infraKey) || importPath.includes(presKey)) {
          results.push({
            ruleId: "DDD-001",
            confidence: 1.0,
            evidence: [{ file: fullPath, message: `Domain layer depends on ${importPath}` }],
            errorCode: "DEPENDENCY_VIOLATION"
          });
        }
      }
      
      if (layer === "application") {
        if (importPath.includes(infraKey) || importPath.includes(presKey)) {
          results.push({
             ruleId: "DDD-002",
             confidence: 1.0,
             evidence: [{ file: fullPath, message: `Application layer depends on ${importPath}` }],
             errorCode: "DEPENDENCY_VIOLATION"
          });
        }
      }
    }

    // Since Spring boot hides domain under src/main/java/..., we should just find all 'domain' folders and walk them
    async function findAndWalkLayers(dir: string) {
      try {
         const entries = await fs.readdir(dir, { withFileTypes: true });
         for (const entry of entries) {
           if (entry.isDirectory()) {
             if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
             if (entry.name === 'domain') await walk(path.join(dir, entry.name), 'domain');
             else if (entry.name === 'application') await walk(path.join(dir, entry.name), 'application');
             else await findAndWalkLayers(path.join(dir, entry.name));
           }
         }
      } catch (e: any) {
        if (e.code !== "ENOENT") {
          errors.push(`Error walking directory ${dir}: ${e.message}`);
        }
      }
    }

    await findAndWalkLayers(rootDir);
    
    if (errors.length > 0) {
      results.push({
        ruleId: "AST-PARSE-ERR",
        confidence: 1.0,
        evidence: errors.map(e => ({ file: targetPath, message: e })),
        errorCode: "PARSE_ERROR"
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Failed to validate architecture: ${error.message}` }],
      isError: true,
    };
  }
}
