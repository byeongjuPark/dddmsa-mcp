import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";
import { extractJavaDataFromAST } from "../utils/javaCstWalker.js";

interface AnalyzeArgs {
  targetPath: string;
}

type DependencyKind = "sync-http" | "async-message" | "grpc" | "infrastructure" | "database";

interface DependencyEdge {
  fromService: string;
  kind: DependencyKind;
  target: string;
  file: string;
}

export async function analyzeServiceDependencies(args: AnalyzeArgs) {
  const { targetPath } = args;
  
  // Map of Dependency string -> list of file paths where it was found
  const dependencies: Map<string, Set<string>> = new Map();
  const databaseResources: Map<string, Map<string, Set<string>>> = new Map();
  const serviceGraphEdges: Map<string, DependencyEdge> = new Map();
  const warnings: string[] = [];

  const addDependency = (dep: string, filePath: string) => {
    if (!dependencies.has(dep)) {
      dependencies.set(dep, new Set());
    }
    dependencies.get(dep)!.add(filePath);
  };

  const addServiceEdge = (kind: DependencyKind, target: string, filePath: string) => {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      return;
    }

    const edge: DependencyEdge = {
      fromService: inferServiceId(filePath),
      kind,
      target: normalizedTarget,
      file: filePath,
    };
    serviceGraphEdges.set(`${edge.fromService}|${edge.kind}|${edge.target}|${edge.file}`, edge);
  };

  const addDatabaseResource = (resource: string, filePath: string) => {
    const serviceId = inferServiceId(filePath);
    if (!databaseResources.has(resource)) {
      databaseResources.set(resource, new Map());
    }
    const services = databaseResources.get(resource)!;
    if (!services.has(serviceId)) {
      services.set(serviceId, new Set());
    }
    services.get(serviceId)!.add(filePath);
    addServiceEdge("database", resource, filePath);
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
            
            if (isTS) {
              const sourceFile = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true);
              ts.forEachChild(sourceFile, function visit(node: ts.Node) {
                  if (ts.isCallExpression(node)) {
                      const exp = node.expression;
                      // fetch or axios check
                      if (ts.isIdentifier(exp) && exp.text === "fetch") {
                          if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                              addDependency(`HTTP API: ${node.arguments[0].text}`, relativePath);
                              addServiceEdge("sync-http", inferHttpTarget(node.arguments[0].text), relativePath);
                          }
                      } else if (ts.isPropertyAccessExpression(exp)) {
                          if (ts.isIdentifier(exp.expression) && exp.expression.text === "axios") {
                              if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                                  addDependency(`HTTP API: ${node.arguments[0].text}`, relativePath);
                                  addServiceEdge("sync-http", inferHttpTarget(node.arguments[0].text), relativePath);
                              }
                          } else if (exp.name.text === "emit" || exp.name.text === "publish" || exp.name.text === "send") {
                              if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                                  addDependency(`Event/Message: ${node.arguments[0].text}`, relativePath);
                                  addServiceEdge("async-message", node.arguments[0].text, relativePath);
                              }
                          } else if (ts.isIdentifier(exp.expression) && exp.expression.text === "client") {
                              addDependency(`gRPC Method: ${exp.name.text}`, relativePath);
                              addServiceEdge("grpc", exp.name.text, relativePath);
                          }
                      }
                  } else if (ts.isImportDeclaration(node)) {
                      const mod = node.moduleSpecifier;
                      if (ts.isStringLiteral(mod)) {
                          if (['mongoose', 'sequelize', 'pg', 'mysql2', 'redis', 'ioredis', 'mongodb'].includes(mod.text)) {
                              addDependency(`Infrastructure: ${mod.text}`, relativePath);
                              addServiceEdge("infrastructure", mod.text, relativePath);
                              addDatabaseResource(`driver:${mod.text}`, relativePath);
                          }
                      }
                  } else if (ts.isClassDeclaration(node)) {
                      const decorators = ts.getDecorators(node) ?? [];
                      for (const decorator of decorators) {
                          const expression = decorator.expression;
                          const decoratorName = ts.isCallExpression(expression)
                              ? getExpressionName(expression.expression)
                              : getExpressionName(expression);
                          if (decoratorName === "Entity" || decoratorName === "Table" || decoratorName === "Schema") {
                              const name = node.name?.text;
                              if (name) {
                                  addDatabaseResource(`model:${name}`, relativePath);
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
                  extraction.dependencies.forEach(dep => {
                      addDependency(dep, relativePath);
                      if (dep.startsWith("HTTP API:")) {
                          addServiceEdge("sync-http", inferHttpTarget(dep.replace("HTTP API:", "").trim()), relativePath);
                      } else if (dep.startsWith("Event/Message:")) {
                          addServiceEdge("async-message", dep.replace("Event/Message:", "").trim(), relativePath);
                      } else if (dep.startsWith("gRPC Method:")) {
                          addServiceEdge("grpc", dep.replace("gRPC Method:", "").trim(), relativePath);
                      }
                      if (dep.startsWith("Database Access:")) {
                          addDatabaseResource(dep.replace("Database Access:", "repository:").trim(), relativePath);
                      }
                  });
              } catch (e: any) {
                  warnings.push(`Failed to extract Java dependencies from ${relativePath}: ${e.message ?? String(e)}`);
              }
            }
          }
        }
      } catch (err: any) {
         if (err.code !== 'ENOENT') {
           warnings.push(`Failed to walk directory ${path.relative(rootDir, dir) || "."}: ${err.message ?? String(err)}`);
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

    const edges = Array.from(serviceGraphEdges.values());
    if (edges.length > 0) {
      results.push({
        ruleId: "DEP-GRAPH",
        confidence: 1.0,
        evidence: edges.map((edge) => ({
          file: edge.file,
          message: `${edge.fromService} -> ${edge.target} [${edge.kind}]`,
        })),
        recommendation: "Use this service graph to review runtime coupling, ownership boundaries, and integration style.",
      });
    }

    const cycles = findServiceCycles(edges);
    for (const cycle of cycles) {
      results.push({
        ruleId: "DEP-GRAPH-CYCLE",
        confidence: 0.85,
        evidence: cycle.map((service) => ({
          file: targetPath,
          message: `Service cycle member: ${service}`,
        })),
        errorCode: "SERVICE_DEPENDENCY_CYCLE",
        recommendation: "Break synchronous service cycles by introducing an owning service, domain event, or query model instead of bidirectional runtime calls.",
      });
    }

    const hotspots = findCouplingHotspots(edges);
    for (const hotspot of hotspots) {
      results.push({
        ruleId: "DEP-GRAPH-HOTSPOT",
        confidence: 0.75,
        evidence: [{
          file: targetPath,
          message: `${hotspot.service} has ${hotspot.count} ${hotspot.direction} service dependencies`,
        }],
        errorCode: "HIGH_SERVICE_COUPLING",
        recommendation: "Review whether this service boundary is too broad, too central, or missing integration contracts.",
      });
    }

    for (const [resource, services] of databaseResources.entries()) {
      if (services.size < 2) {
        continue;
      }

      const evidence = Array.from(services.entries()).flatMap(([serviceId, files]) =>
        Array.from(files).map((file) => ({
          file,
          message: `Database resource ${resource} is used by service ${serviceId}`,
        }))
      );

      results.push({
        ruleId: "MSA-DB-SHARED",
        confidence: 0.8,
        evidence,
        errorCode: "SHARED_DATABASE_RESOURCE",
        recommendation: "Avoid sharing a database resource across services; prefer service-owned data and integration events/contracts.",
      });
    }

    if (warnings.length > 0) {
      results.push({
        ruleId: "DEP-ANALYSIS-WARN",
        confidence: 1.0,
        evidence: warnings.map((message) => ({ file: targetPath, message })),
        errorCode: "ANALYSIS_WARNING",
        recommendation: "Review warnings because dependency analysis may be incomplete.",
      });
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

function inferServiceId(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/");

  const serviceIndex = segments.findIndex((segment) => segment === "services" || segment === "apps");
  if (serviceIndex >= 0 && segments[serviceIndex + 1]) {
    return segments[serviceIndex + 1];
  }

  return segments[0] || ".";
}

function inferHttpTarget(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const normalized = url.replace(/^\/+/, "");
    return normalized.split(/[/?#]/)[0] || url;
  }
}

function findServiceCycles(edges: DependencyEdge[]): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.kind !== "sync-http" && edge.kind !== "grpc") {
      continue;
    }
    const targetService = normalizeServiceTarget(edge.target);
    if (!targetService || targetService === edge.fromService || edge.fromService === ".") {
      continue;
    }
    if (!graph.has(edge.fromService)) {
      graph.set(edge.fromService, new Set());
    }
    graph.get(edge.fromService)!.add(targetService);
  }

  const cycles = new Map<string, string[]>();
  const visit = (start: string, current: string, pathStack: string[]) => {
    const nextServices = graph.get(current) ?? new Set<string>();
    for (const next of nextServices) {
      if (next === start) {
        const cycle = [...pathStack, next];
        cycles.set(canonicalCycleKey(cycle), cycle);
        continue;
      }
      if (pathStack.includes(next)) {
        continue;
      }
      visit(start, next, [...pathStack, next]);
    }
  };

  for (const service of graph.keys()) {
    visit(service, service, [service]);
  }

  return Array.from(cycles.values());
}

function findCouplingHotspots(edges: DependencyEdge[]) {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.fromService === ".") {
      continue;
    }
    const targetService = normalizeServiceTarget(edge.target);
    if (!targetService || targetService === edge.fromService) {
      continue;
    }
    if (!outgoing.has(edge.fromService)) {
      outgoing.set(edge.fromService, new Set());
    }
    outgoing.get(edge.fromService)!.add(`${edge.kind}:${targetService}`);

    if (!incoming.has(targetService)) {
      incoming.set(targetService, new Set());
    }
    incoming.get(targetService)!.add(edge.fromService);
  }

  const hotspots: Array<{ service: string; direction: "outgoing" | "incoming"; count: number }> = [];
  for (const [service, targets] of outgoing.entries()) {
    if (targets.size >= 4) {
      hotspots.push({ service, direction: "outgoing", count: targets.size });
    }
  }
  for (const [service, sources] of incoming.entries()) {
    if (sources.size >= 3) {
      hotspots.push({ service, direction: "incoming", count: sources.size });
    }
  }
  return hotspots;
}

function normalizeServiceTarget(target: string): string | undefined {
  const cleaned = target
    .replace(/^https?:\/\//, "")
    .split(/[/:?#]/)[0]
    .trim();
  if (!cleaned || cleaned === "localhost" || cleaned === "127.0.0.1") {
    return undefined;
  }
  if (!cleaned.includes("-") && !cleaned.includes(".")) {
    return undefined;
  }
  return cleaned;
}

function canonicalCycleKey(cycle: string[]): string {
  const members = cycle.slice(0, -1);
  const rotations = members.map((_, index) => {
    const rotated = [...members.slice(index), ...members.slice(0, index)];
    return [...rotated, rotated[0]].join("->");
  });
  return rotations.sort()[0];
}

function getExpressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}
