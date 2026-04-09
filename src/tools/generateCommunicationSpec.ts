import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";
import * as Diff from "diff";
import { extractJavaDataFromAST } from "../utils/javaCstWalker.js";

interface GenerateSpecArgs {
  sourcePath: string;
  outputFormat: "openapi" | "grpc";
  dryRun?: boolean;
  overwrite?: boolean;
}

export async function generateCommunicationSpec(args: GenerateSpecArgs) {
  const { sourcePath, outputFormat, dryRun = false, overwrite = false } = args;
  const targetDir = resolveSafePath(process.cwd(), sourcePath);

  try {
    const endpoints: { method: string, path: string }[] = [];
    const warnings: string[] = [];

    async function walk(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
           if (entry.isDirectory()) {
             if (['node_modules', 'dist', 'build', '.git', 'target'].includes(entry.name)) continue;
             await walk(path.join(dir, entry.name));
           } else {
             const ext = path.extname(entry.name);
             const isTS = ext === '.ts' || ext === '.js';
             const isJava = ext === '.java' || ext === '.kt';
             
             if (isTS || isJava) {
               try {
                 const content = await fs.readFile(path.join(dir, entry.name), "utf-8");
                 if (isTS) {
                   const sourceFile = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true);
                   ts.forEachChild(sourceFile, function visit(node: ts.Node) {
                       if (ts.isCallExpression(node)) {
                           const exp = node.expression;
                           if (ts.isPropertyAccessExpression(exp)) {
                               const method = exp.name.text;
                               if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
                                   if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                                        endpoints.push({ method, path: node.arguments[0].text });
                                   }
                               }
                           }
                       }
                       ts.forEachChild(node, visit);
                   });
                 }
                 if (isJava) {
                   try {
                       const extraction = extractJavaDataFromAST(content);
                       extraction.endpoints.forEach(ep => endpoints.push(ep));
                   } catch(e) {}
                 }
               } catch (err: any) {
                 warnings.push(`Warning: Could not read file ${path.join(dir, entry.name)}: ${err.message}`);
               }
             }
           }
        }
      } catch (e: any) {
        warnings.push(`Warning: directory walk failed for ${dir}: ${e.message}`);
      }
    }

    await walk(targetDir);

    // Fallback if no endpoints found
    if (endpoints.length === 0) {
      endpoints.push({ method: "get", path: "/api/health" });
    }

    let specContent = "";
    let fileName = "";
    
    if (outputFormat === "openapi") {
      fileName = "openapi.json";
      const pathsObj: any = {};
      for (const ep of endpoints) {
        if (!pathsObj[ep.path]) pathsObj[ep.path] = {};
        pathsObj[ep.path][ep.method] = {
          summary: `Auto-detected ${ep.method.toUpperCase()} endpoint`,
          responses: { "200": { description: "OK" } }
        };
      }

      specContent = JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "Generated Service API",
          version: "1.0.0"
        },
        paths: pathsObj
      }, null, 2);
    } else if (outputFormat === "grpc") {
      fileName = "service.proto";
      const rpcLines = endpoints.map((ep, i) => `  rpc Handle${ep.method.toUpperCase()}Endpoint${i} (Empty) returns (ResponseType);`).join("\n");
      specContent = `syntax = "proto3";\n\npackage service;\n\nservice GeneratedService {\n${rpcLines}\n}\n\nmessage Empty {}\nmessage ResponseType {\n  string status = 1;\n}\n`;
    } else {
      throw new Error("Unsupported output format");
    }

    const outputPath = path.join(targetDir, fileName);
    
    let existingContent = "";
    try {
        existingContent = await fs.readFile(outputPath, 'utf-8');
        if (!overwrite) {
            throw new Error(`Spec already exists at ${outputPath}. Pass 'overwrite: true' to force.`);
        }
    } catch (e: any) {
        if (e.message.includes('already exists')) throw e;
    }

    if (dryRun) {
        let diffStr = "";
        if (existingContent) {
           const patch = Diff.createTwoFilesPatch(fileName, fileName, existingContent, specContent, "Existing", "New");
           diffStr = `[DRY RUN] Diff of modifications:\n\n${patch}`;
        } else {
           diffStr = `[DRY RUN] Would create with content:\n\n${specContent}`;
        }
        
        const dryRunResults: ToolResult[] = [{
           ruleId: "SPEC-DRY",
           confidence: 1.0,
           evidence: [{ file: outputPath, message: diffStr }]
        }];
        return {
           content: [{ type: "text", text: JSON.stringify(dryRunResults, null, 2) }]
        }
    }

    await fs.writeFile(outputPath, specContent);

    const results: ToolResult[] = [];
    results.push({
      ruleId: "SPEC-GEN",
      confidence: 1.0,
      evidence: endpoints.map(ep => ({ file: outputPath, message: `Discovered endpoint ${ep.method.toUpperCase()} ${ep.path}` })),
    });

    if (warnings.length > 0) {
       results.push({
          ruleId: "SPEC-GEN-WARN",
          confidence: 1.0,
          evidence: warnings.map(w => ({ file: targetDir, message: w })),
          errorCode: "WARNING"
       });
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to generate spec: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
