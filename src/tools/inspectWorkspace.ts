import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { resolveSafePath } from "../utils/pathUtils.js";
import { extractJavaDataFromAST } from "../utils/javaCstWalker.js";

interface InspectWorkspaceArgs {
  targetPath?: string;
}

interface WorkspaceEvidence {
  file: string;
  message: string;
}

interface WorkspaceModel {
  root: string;
  ecosystems: string[];
  buildTools: string[];
  sourceRoots: string[];
  dddLayers: Record<string, string[]>;
  entrypoints: WorkspaceEvidence[];
  repositories: WorkspaceEvidence[];
  dependencySignals: WorkspaceEvidence[];
  recommendations: string[];
}

const IGNORED_DIRS = new Set([
  ".git",
  ".gradle",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const LAYER_NAMES = new Set(["domain", "application", "infrastructure", "presentation"]);

export async function inspectWorkspace(args: InspectWorkspaceArgs = {}) {
  const targetPath = args.targetPath ?? ".";

  try {
    const rootDir = resolveSafePath(process.cwd(), targetPath);
    await fs.access(rootDir);

    const model: WorkspaceModel = {
      root: rootDir,
      ecosystems: [],
      buildTools: [],
      sourceRoots: [],
      dddLayers: {
        domain: [],
        application: [],
        infrastructure: [],
        presentation: [],
      },
      entrypoints: [],
      repositories: [],
      dependencySignals: [],
      recommendations: [],
    };

    const ecosystemSet = new Set<string>();
    const buildToolSet = new Set<string>();
    const sourceRootSet = new Set<string>();

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath) || ".";

        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) {
            continue;
          }

          if (LAYER_NAMES.has(entry.name)) {
            model.dddLayers[entry.name].push(relativePath);
          }

          if (isSourceRoot(relativePath)) {
            sourceRootSet.add(relativePath);
          }

          await walk(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        detectProjectFiles(entry.name, relativePath, ecosystemSet, buildToolSet);

        const extension = path.extname(entry.name);
        if (extension === ".ts" || extension === ".js") {
          ecosystemSet.add("typescript");
          await inspectTypeScriptFile(fullPath, relativePath, model);
        } else if (extension === ".java" || extension === ".kt") {
          ecosystemSet.add("spring");
          await inspectJavaFile(fullPath, relativePath, model);
        }
      }
    }

    await walk(rootDir);

    model.ecosystems = Array.from(ecosystemSet).sort();
    model.buildTools = Array.from(buildToolSet).sort();
    model.sourceRoots = Array.from(sourceRootSet).sort();
    model.recommendations = buildRecommendations(model);

    return {
      content: [{ type: "text", text: JSON.stringify(model, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              errorCode: "INSPECT_WORKSPACE_FAILED",
              message: error.message,
              targetPath,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

function detectProjectFiles(
  fileName: string,
  relativePath: string,
  ecosystemSet: Set<string>,
  buildToolSet: Set<string>
) {
  if (fileName === "package.json" || fileName === "tsconfig.json") {
    ecosystemSet.add("typescript");
  }
  if (fileName === "package.json") {
    buildToolSet.add("npm");
  }
  if (fileName === "pom.xml") {
    ecosystemSet.add("spring");
    buildToolSet.add("maven");
  }
  if (fileName === "build.gradle" || fileName === "build.gradle.kts") {
    ecosystemSet.add("spring");
    buildToolSet.add("gradle");
  }
  if (fileName === "package.json" || fileName === "pom.xml" || fileName.startsWith("build.gradle")) {
    buildToolSet.add(`${fileName}:${relativePath}`);
  }
}

function isSourceRoot(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return (
    normalized === "src" ||
    normalized === "src/main/java" ||
    normalized === "src/main/kotlin" ||
    normalized === "src/test/java" ||
    normalized === "src/test/kotlin" ||
    normalized.endsWith("/src") ||
    normalized.endsWith("/src/main/java") ||
    normalized.endsWith("/src/main/kotlin")
  );
}

async function inspectTypeScriptFile(fullPath: string, relativePath: string, model: WorkspaceModel) {
  const content = await fs.readFile(fullPath, "utf-8");
  const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
  const fileName = path.basename(relativePath).toLowerCase();

  if (fileName.includes("controller") || fileName.includes("route") || fileName.includes("handler")) {
    model.entrypoints.push({ file: relativePath, message: "TypeScript entrypoint naming convention" });
  }

  if (fileName.includes("repository")) {
    model.repositories.push({ file: relativePath, message: "TypeScript repository naming convention" });
  }

  ts.forEachChild(sourceFile, function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "fetch") {
        addStringArgumentSignal(node, relativePath, "HTTP fetch", model);
      } else if (ts.isPropertyAccessExpression(expression)) {
        const owner = expression.expression;
        const method = expression.name.text;

        if (ts.isIdentifier(owner) && owner.text === "axios") {
          addStringArgumentSignal(node, relativePath, `HTTP axios.${method}`, model);
        } else if (["emit", "publish", "send"].includes(method)) {
          addStringArgumentSignal(node, relativePath, `Message ${method}`, model);
        }

        if (["get", "post", "put", "delete", "patch"].includes(method)) {
          addStringArgumentSignal(node, relativePath, `Route ${method.toUpperCase()}`, model, true);
        }
      }
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      if (["pg", "mysql2", "mongodb", "mongoose", "redis", "ioredis", "sequelize"].includes(moduleName)) {
        model.dependencySignals.push({ file: relativePath, message: `Infrastructure import: ${moduleName}` });
      }
    }

    ts.forEachChild(node, visit);
  });
}

function addStringArgumentSignal(
  node: ts.CallExpression,
  relativePath: string,
  label: string,
  model: WorkspaceModel,
  entrypoint = false
) {
  const arg = node.arguments[0];
  if (!arg || !ts.isStringLiteral(arg)) {
    return;
  }

  const evidence = { file: relativePath, message: `${label}: ${arg.text}` };
  if (entrypoint) {
    model.entrypoints.push(evidence);
  } else {
    model.dependencySignals.push(evidence);
  }
}

async function inspectJavaFile(fullPath: string, relativePath: string, model: WorkspaceModel) {
  const content = await fs.readFile(fullPath, "utf-8");
  const fileName = path.basename(relativePath).toLowerCase();

  if (fileName.includes("controller")) {
    model.entrypoints.push({ file: relativePath, message: "Java/Spring controller naming convention" });
  }

  if (fileName.includes("repository")) {
    model.repositories.push({ file: relativePath, message: "Java/Spring repository naming convention" });
  }

  try {
    const extraction = extractJavaDataFromAST(content);
    for (const endpoint of extraction.endpoints) {
      model.entrypoints.push({
        file: relativePath,
        message: `Spring endpoint: ${endpoint.method.toUpperCase()} ${endpoint.path}`,
      });
    }
    for (const dependency of extraction.dependencies) {
      model.dependencySignals.push({ file: relativePath, message: dependency });
    }
    for (const importPath of extraction.imports) {
      if (importPath.includes("Repository")) {
        model.repositories.push({ file: relativePath, message: `Repository-related import: ${importPath}` });
      }
    }
  } catch (error: any) {
    model.dependencySignals.push({
      file: relativePath,
      message: `Java parse warning: ${error.message}`,
    });
  }
}

function buildRecommendations(model: WorkspaceModel): string[] {
  const recommendations: string[] = [];
  const missingLayers = Object.entries(model.dddLayers)
    .filter(([, paths]) => paths.length === 0)
    .map(([layer]) => layer);

  if (missingLayers.length > 0) {
    recommendations.push(`Missing DDD layer directories: ${missingLayers.join(", ")}`);
  }
  if (model.entrypoints.length > 0 && model.repositories.length === 0) {
    recommendations.push("Entrypoints were found, but no repository boundary was detected.");
  }
  if (model.dependencySignals.length > 0) {
    recommendations.push("Run analyze_service_dependencies for a detailed dependency evidence report.");
  }
  if (model.ecosystems.length === 0) {
    recommendations.push("No supported TypeScript or Spring ecosystem markers were detected.");
  }

  return recommendations;
}

