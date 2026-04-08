import fs from "fs/promises";
import path from "path";

interface ScaffoldArgs {
  targetPath: string;
  serviceName: string;
  language?: "typescript" | "spring" | "auto";
  basePackage?: string;
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
  } catch (e) {
    // ignore
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
  } catch (e) {}

  return "com.example.service";
}

export async function scaffoldDddService(args: ScaffoldArgs) {
  let { targetPath, serviceName, language = "auto", basePackage } = args;

  try {
    const projectRoot = process.cwd();
    
    if (language === "auto") {
      language = await detectLanguage(projectRoot);
    }
    if (!basePackage && language === "spring") {
      basePackage = await detectBasePackage(projectRoot);
    }

    const rootDir = path.join(projectRoot, targetPath, serviceName);

    let directories: string[] = [];
    
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
      await fs.mkdir(rootDir, { recursive: true });
      const gradleContent = `plugins {
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
      await fs.writeFile(path.join(rootDir, "build.gradle"), gradleContent);
      
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
      await fs.mkdir(path.join(rootDir, dir), { recursive: true });
      // Create an empty .gitkeep file to ensure empty directories are committed
      await fs.writeFile(path.join(rootDir, dir, ".gitkeep"), "");
    }

    // Create a README file
    const readmeContent = `# ${serviceName} Microservice\n\nThis service follows Domain-Driven Design principles.\nLanguage: ${language}\n`;
    await fs.writeFile(path.join(rootDir, "README.md"), readmeContent);

    return {
      content: [
        {
          type: "text",
          text: `Successfully scaffolded ${language} DDD service '${serviceName}' at ${path.join(process.cwd(), targetPath)} (Base Package: ${basePackage || 'N/A'})`,
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to scaffold DDD service: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
