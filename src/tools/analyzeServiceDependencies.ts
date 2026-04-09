import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { parse } from "java-parser";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";
import { extractJavaDataFromAST } from "../utils/javaCstWalker.js";

interface AnalyzeArgs {
  targetPath: string;
}

export async function analyzeServiceDependencies(args: AnalyzeArgs) {
  const { targetPath } = args;
  
  // Map of Dependency string -> list of file paths where it was found
  const dependencies: Map<string, Set<string>> = new Map();

  const addDependency = (dep: string, filePath: string) => {
    if (!dependencies.has(dep)) {
      dependencies.set(dep, new Set());
    }
    dependencies.get(dep)!.add(filePath);
  };

  try {
    const rootDir = resolveSafePath(process.cwd(), targetPath);
    await fs.access(rootDir);

    async function walk(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Ignore heavy or irrelevant directories
          if (entry.isDirectory()) {
            if (['node_modules', 'dist', 'build', 'coverage', '.git', '.gradle', 'target'].includes(entry.name)) {
              continue; // Skip
            }
            await walk(path.join(dir, entry.name));
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            const isTS = ext === '.ts' || ext === '.js';
            const isJava = ext === '.java' || ext === '.kt';

            if (!isTS && !isJava) continue;

            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(rootDir, fullPath);
            const content = await fs.readFile(fullPath, "utf-8");
            
            let match;
            
            if (isTS) {
              const sourceFile = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true);
              ts.forEachChild(sourceFile, function visit(node: ts.Node) {
                  if (ts.isCallExpression(node)) {
                      const exp = node.expression;
                      // fetch or axios check
                      if (ts.isIdentifier(exp) && exp.text === "fetch") {
                          if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                              addDependency(`HTTP API: ${node.arguments[0].text}`, relativePath);
                          }
                      } else if (ts.isPropertyAccessExpression(exp)) {
                          if (ts.isIdentifier(exp.expression) && exp.expression.text === "axios") {
                              if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                                  addDependency(`HTTP API: ${node.arguments[0].text}`, relativePath);
                              }
                          } else if (exp.name.text === "emit" || exp.name.text === "publish" || exp.name.text === "send") {
                              if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                                  addDependency(`Event/Message: ${node.arguments[0].text}`, relativePath);
                              }
                          } else if (ts.isIdentifier(exp.expression) && exp.expression.text === "client") {
                              addDependency(`gRPC Method: ${exp.name.text}`, relativePath);
                          }
                      }
                  } else if (ts.isImportDeclaration(node)) {
                      const mod = node.moduleSpecifier;
                      if (ts.isStringLiteral(mod)) {
                          if (['mongoose', 'sequelize', 'pg', 'mysql2', 'redis', 'ioredis', 'mongodb'].includes(mod.text)) {
                              addDependency(`Infrastructure: ${mod.text}`, relativePath);
                          }
                      }
                  }
                  ts.forEachChild(node, visit);
              });
            }

            if (isJava) {
              try {
                  const extraction = extractJavaDataFromAST(content);
                  extraction.dependencies.forEach(dep => {
                      addDependency(dep, relativePath);
                  });
              } catch (e) {}
            }
          }
        }
      } catch (err: any) {
         if (err.code !== 'ENOENT') {
           console.error(`Error walking directory ${dir}:`, err);
         }
      }
    }

    await walk(rootDir);

    const results: ToolResult[] = [];
    if (dependencies.size === 0) {
       results.push({
         ruleId: "DEP-ANALYSIS-001",
         confidence: 1.0,
         evidence: [],
         recommendation: "No external dependencies found."
       });
    } else {
       for (const [dep, files] of dependencies.entries()) {
          results.push({
            ruleId: "DEP-ANALYSIS-002",
            confidence: 1.0,
            evidence: Array.from(files).map(f => ({ file: f, message: `Found dependency: ${dep}` }))
          });
       }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  } catch (error: any) {
    const errorResults: ToolResult[] = [{
       ruleId: "DEP-FAIL",
       confidence: 0,
       errorCode: "DEP_ERR",
       evidence: [{ file: targetPath, message: error.message }]
    }];
    return {
      content: [{ type: "text", text: JSON.stringify(errorResults, null, 2) }],
      isError: true,
    };
  }
}
