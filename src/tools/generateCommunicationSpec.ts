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

interface EndpointSpec {
  method: string;
  path: string;
  file?: string;
  line?: number;
  requestType?: string;
  responseType?: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  format?: string;
  $ref?: string;
}

export async function generateCommunicationSpec(args: GenerateSpecArgs) {
  const { sourcePath, outputFormat, dryRun = false, overwrite = false } = args;
  const targetDir = resolveSafePath(process.cwd(), sourcePath);

  try {
    const endpoints: EndpointSpec[] = [];
    const schemas = new Map<string, JsonSchema>();
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
                 const relativePath = path.relative(targetDir, path.join(dir, entry.name));
                 if (isTS) {
                   const sourceFile = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true);
                   collectTypeSchemas(sourceFile, schemas);
                   ts.forEachChild(sourceFile, function visit(node: ts.Node) {
                       if (ts.isCallExpression(node)) {
                           const exp = node.expression;
                           if (ts.isPropertyAccessExpression(exp)) {
                               const method = exp.name.text;
                               if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
                                   if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                                        const signature = extractHandlerSignature(node.arguments[1]);
                                        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
                                        endpoints.push({
                                          method,
                                          path: node.arguments[0].text,
                                          file: relativePath,
                                          line,
                                          ...signature,
                                        });
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
                       extraction.endpoints.forEach(ep => endpoints.push({ ...ep, file: relativePath }));
                   } catch(e: any) {
                       warnings.push(`Warning: Could not parse Java file ${path.join(dir, entry.name)}: ${e.message}`);
                   }
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
        const operation: any = {
          summary: `Auto-detected ${ep.method.toUpperCase()} endpoint`,
          responses: {
            "200": {
              description: "OK",
              ...(ep.responseType ? {
                content: {
                  "application/json": {
                    schema: schemaForType(ep.responseType, schemas),
                  },
                },
              } : {}),
            },
          },
        };

        if (ep.file || ep.line) {
          operation["x-source"] = {
            ...(ep.file ? { file: ep.file } : {}),
            ...(ep.line ? { line: ep.line } : {}),
          };
        }

        if (ep.requestType && !["get", "delete"].includes(ep.method)) {
          operation.requestBody = {
            required: true,
            content: {
              "application/json": {
                schema: schemaForType(ep.requestType, schemas),
              },
            },
          };
        }

        pathsObj[ep.path][ep.method] = {
          ...operation,
        };
      }

      specContent = JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "Generated Service API",
          version: "1.0.0"
        },
        paths: pathsObj,
        ...(schemas.size > 0 ? { components: { schemas: Object.fromEntries(schemas.entries()) } } : {})
      }, null, 2);
    } else if (outputFormat === "grpc") {
      fileName = "service.proto";
      const rpcLines = endpoints.map((ep, i) => {
        const sourceComment = ep.file ? `  // source: ${ep.file}${ep.line ? `:${ep.line}` : ""}\n` : "";
        return `${sourceComment}  rpc Handle${ep.method.toUpperCase()}Endpoint${i} (Empty) returns (ResponseType);`;
      }).join("\n");
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
      evidence: endpoints.map(ep => ({
        file: ep.file ?? outputPath,
        line: ep.line,
        message: `Discovered endpoint ${ep.method.toUpperCase()} ${ep.path}${ep.requestType ? ` request=${ep.requestType}` : ""}${ep.responseType ? ` response=${ep.responseType}` : ""}`,
      })),
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

function collectTypeSchemas(sourceFile: ts.SourceFile, schemas: Map<string, JsonSchema>) {
  ts.forEachChild(sourceFile, function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
      const name = node.name?.text;
      if (name) {
        const properties: Record<string, JsonSchema> = {};
        const required: string[] = [];
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) && !ts.isPropertyDeclaration(member)) {
            continue;
          }
          const propertyName = getPropertyName(member.name);
          if (!propertyName) {
            continue;
          }
          properties[propertyName] = typeNodeToSchema(member.type);
          if (!member.questionToken) {
            required.push(propertyName);
          }
        }
        schemas.set(name, {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        });
      }
    }
    ts.forEachChild(node, visit);
  });
}

function extractHandlerSignature(handler: ts.Node | undefined): Pick<EndpointSpec, "requestType" | "responseType"> {
  if (!handler) {
    return {};
  }

  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    return {
      requestType: extractRequestType(handler.parameters[0]?.type),
      responseType: extractResponseType(handler.type),
    };
  }

  return {};
}

function extractRequestType(typeNode: ts.TypeNode | undefined): string | undefined {
  if (!typeNode) {
    return undefined;
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName.getText();
    if (typeName === "Request" && typeNode.typeArguments?.[2]) {
      return typeNode.typeArguments[2].getText();
    }
    return typeName;
  }
  return undefined;
}

function extractResponseType(typeNode: ts.TypeNode | undefined): string | undefined {
  if (!typeNode) {
    return undefined;
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName.getText();
    if (typeName === "Promise" && typeNode.typeArguments?.[0]) {
      return typeNode.typeArguments[0].getText();
    }
    return typeName;
  }
  return undefined;
}

function schemaForType(typeName: string, schemas: Map<string, JsonSchema>): JsonSchema {
  if (schemas.has(typeName)) {
    return { $ref: `#/components/schemas/${typeName}` };
  }
  return typeNodeTextToSchema(typeName);
}

function typeNodeToSchema(typeNode: ts.TypeNode | undefined): JsonSchema {
  if (!typeNode) {
    return {};
  }
  return typeNodeTextToSchema(typeNode.getText());
}

function typeNodeTextToSchema(typeText: string): JsonSchema {
  const normalized = typeText.trim();
  if (normalized === "string") return { type: "string" };
  if (normalized === "number") return { type: "number" };
  if (normalized === "boolean") return { type: "boolean" };
  if (normalized === "Date") return { type: "string", format: "date-time" };
  if (normalized.endsWith("[]")) return { type: "array", items: typeNodeTextToSchema(normalized.slice(0, -2)) };
  if (normalized.startsWith("Array<") && normalized.endsWith(">")) {
    return { type: "array", items: typeNodeTextToSchema(normalized.slice(6, -1)) };
  }
  const literalUnion = normalized.split("|").map((part) => part.trim().replace(/^["']|["']$/g, ""));
  if (literalUnion.length > 1 && literalUnion.every(Boolean)) {
    return { type: "string", enum: literalUnion };
  }
  return { $ref: `#/components/schemas/${normalized}` };
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}
