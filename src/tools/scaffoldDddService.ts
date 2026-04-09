import fs from "fs/promises";
import path from "path";
import { resolveSafePath } from "../utils/pathUtils.js";
import { ToolResult } from "../types/ResultTypes.js";

interface ScaffoldArgs {
  targetPath: string;
  serviceName: string;
  language?: "typescript" | "spring" | "auto";
  basePackage?: string;
  dryRun?: boolean;
  overwrite?: boolean;
}

async function detectLanguage(basePath: string): Promise<"typescript" | "spring"> {
  try {
    const files = await fs.readdir(basePath);
    if (files.includes("build.gradle") || files.includes("pom.xml") || files.includes("build.gradle.kts")) {
      return "spring";
    }
    if (files.includes("package.json") || files.includes("tsconfig.json")) {
      return "typescript";
    }
  } catch (e: any) {
    console.warn(`[Warning] detectLanguage failed: ${e.message}. Falling back to 'typescript'.`);
  }
  return "typescript"; // default fallback
}

async function detectBasePackage(basePath: string): Promise<string> {
  // Try to find an existing java directory structure to guess the base package
  try {
    async function searchJavaPath(currentPath: string, depth: number): Promise<string | null> {
      if (depth > 6) return null;
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          if (currentPath.includes(path.join('src', 'main', 'java'))) {
             // Extract path after java/
             const javaIdx = currentPath.replace(/\\/g, '/').indexOf('src/main/java/');
             if (javaIdx !== -1) {
               const pkgPath = currentPath.substring(javaIdx + 14).replace(/\\/g, '/').replace(/^\//, '');
               if (pkgPath.split('/').length >= 2) {
                 return pkgPath.split('/').join('.');
               }
             }
          }
          const found = await searchJavaPath(path.join(currentPath, entry.name), depth + 1);
          if (found) return found;
        }
      }
      return null;
    }
    const foundPkg = await searchJavaPath(basePath, 0);
    if (foundPkg) return foundPkg;
  } catch (e: any) {
    console.warn(`[Warning] detectBasePackage failed: ${e.message}. Falling back to 'com.example.service'.`);
  }

  return "com.example.service";
}

export async function scaffoldDddService(args: ScaffoldArgs) {
  let { targetPath, serviceName, language = "auto", basePackage, dryRun = false, overwrite = false } = args;

  try {
    const projectRoot = process.cwd();
    
    if (language === "auto") {
      language = await detectLanguage(projectRoot);
    }
    if (!basePackage && language === "spring") {
      basePackage = await detectBasePackage(projectRoot);
    }

    const rootDir = resolveSafePath(projectRoot, path.join(targetPath, serviceName));

    if (!overwrite) {
      try {
        await fs.access(rootDir);
        throw new Error(`Directory ${rootDir} already exists. Pass 'overwrite: true' to force.`);
      } catch (e: any) {
        if (e.message.includes('already exists')) throw e;
      }
    }

    let directories: string[] = [];
    const plannedWrites: string[] = [];
    let gradleContent = "";
    
    if (language === "spring") {
      const pkg = basePackage || "com.example.service";
      const packagePath = pkg.replace(/\./g, '/');
      const baseDir = `src/main/java/${packagePath}`;
      directories = [
        `${baseDir}/domain/entities`,
        `${baseDir}/domain/valueobjects`,
        `${baseDir}/domain/repositories`,
        `${baseDir}/domain/events`,
        `${baseDir}/application/usecases`,
        `${baseDir}/application/dto`,
        `${baseDir}/infrastructure/persistence`,
        `${baseDir}/infrastructure/messaging`,
        `${baseDir}/infrastructure/client`,
        `${baseDir}/presentation/controllers`,
        `${baseDir}/presentation/exception`,
        `src/main/resources`,
        `src/test/java/${packagePath}`
      ];

      // Add default build.gradle
      gradleContent = `plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

group = '${pkg.split('.').slice(0, 2).join('.')}'
version = '0.0.1-SNAPSHOT'

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
`;
      plannedWrites.push(path.join(rootDir, "build.gradle"));
      
    } else {
      directories = [
        "domain/entities",
        "domain/valueObjects",
        "domain/repositories",
        "domain/events",
        "application/useCases",
        "application/dto",
        "application/interfaces",
        "infrastructure/persistence",
        "infrastructure/messaging/kafka",
        "infrastructure/http",
        "presentation/controllers",
        "presentation/routes",
        "presentation/middlewares",
      ];
    }

    for (const dir of directories) {
      plannedWrites.push(path.join(rootDir, dir, ".gitkeep"));
    }
    plannedWrites.push(path.join(rootDir, "README.md"));

    if (dryRun) {
      const results: ToolResult[] = [{
        ruleId: "SCAFFOLD-DRY",
        confidence: 1.0,
        evidence: plannedWrites.map(p => ({ file: p, message: "Planned directory or file creation" })),
        recommendation: "Review planned scaffold targets before writing"
      }];
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      }
    }

    await fs.mkdir(rootDir, { recursive: true });
    
    if (gradleContent) {
      await fs.writeFile(path.join(rootDir, "build.gradle"), gradleContent);
    }

    for (const dir of directories) {
      await fs.mkdir(path.join(rootDir, dir), { recursive: true });
      // Create an empty .gitkeep file to ensure empty directories are committed
      await fs.writeFile(path.join(rootDir, dir, ".gitkeep"), "");
    }

    // Create a README file
    const readmeContent = `# ${serviceName} Microservice\n\nThis service follows Domain-Driven Design principles.\nLanguage: ${language}\n`;
    await fs.writeFile(path.join(rootDir, "README.md"), readmeContent);

    const results: ToolResult[] = [{
       ruleId: "SCAFFOLD-WRITE",
       confidence: 1.0,
       evidence: [{ file: rootDir, message: "Scaffold successful" }]
    }];

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  } catch (error: any) {
    const errorResults: ToolResult[] = [{
       ruleId: "SCAFFOLD-FAIL",
       confidence: 0,
       errorCode: "SCAFFOLD_ERR",
       evidence: [{ file: targetPath, message: error.message }]
    }];
    return {
      content: [{ type: "text", text: JSON.stringify(errorResults, null, 2) }],
      isError: true,
    };
  }
}
