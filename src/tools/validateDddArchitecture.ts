import fs from "fs/promises";
import path from "path";

interface ValidateArgs {
  targetPath: string;
}

export async function validateDddArchitecture(args: ValidateArgs) {
  const { targetPath } = args;
  const rootDir = path.join(process.cwd(), targetPath);
  const violations: string[] = [];

  try {
    // Regex for TypeScript/JS imports
    const tsImportRegex = /import\s+.*?\s+from\s+['"](.*?)['"];/g;
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
              const content = await fs.readFile(fullPath, "utf-8");
              let match;
              
              if (isTS) {
                while ((match = tsImportRegex.exec(content)) !== null) {
                  const importPath = match[1];
                  checkViolation(fullPath, importPath, layer, "application", "infrastructure", "presentation");
                }
              }
              
              if (isJava) {
                while ((match = javaImportRegex.exec(content)) !== null) {
                  const importPath = match[1];
                  checkViolation(fullPath, importPath, layer, ".application.", ".infrastructure.", ".presentation.");
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.error(`Error walking directory ${dir}:`, err);
        }
      }
    }

    function checkViolation(fullPath: string, importPath: string, layer: string, appKey: string, infraKey: string, presKey: string) {
      if (layer === "domain") {
        if (importPath.includes(appKey) || importPath.includes(infraKey) || importPath.includes(presKey)) {
          violations.push(`Violation in ${fullPath}: Domain layer must not depend on ${importPath}`);
        }
      }
      
      if (layer === "application") {
        if (importPath.includes(infraKey) || importPath.includes(presKey)) {
          violations.push(`Violation in ${fullPath}: Application layer must not depend on ${importPath}`);
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
      } catch (e) {}
    }

    await findAndWalkLayers(rootDir);
    
    if (violations.length === 0) {
      return {
        content: [{ type: "text", text: `✅ Architecture validation passed for ${targetPath}. No DDD dependency violations found.` }],
      };
    } else {
      return {
        content: [{ type: "text", text: `❌ Architecture violations found in ${targetPath}:\n\n` + violations.join('\n') }],
      };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Failed to validate architecture: ${error.message}` }],
      isError: true,
    };
  }
}
