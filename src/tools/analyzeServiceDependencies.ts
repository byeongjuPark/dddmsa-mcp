import fs from "fs/promises";
import path from "path";
import { resolveSafePath } from "../utils/pathUtils.js";

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

    // Improved Regex Patterns (TypeScript/Node)
    const httpRegex = /(?:axios\.(?:get|post|put|delete|patch|request)|fetch)\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/g;
    const grpcRegex = /client\.([a-zA-Z0-9_]+)\(/g;
    const eventRegex = /(?:\.emit|\.publish|\.send)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const dbRegex = /from\s+['"](mongoose|sequelize|pg|mysql2|redis|ioredis|mongodb)['"]/g;

    // Regex Patterns (Java/Spring Boot)
    const springFeignRegex = /@FeignClient\s*\(\s*(?:name|value)?\s*=?\s*["']([^"']+)["']/g;
    const springHttpRegex = /(?:RestTemplate|WebClient).*?\.(?:getForObject|postForEntity|exchange|get|post)\s*\(\s*["'](http.*?)["']/g;
    const springEventRegex = /(?:KafkaTemplate|RabbitTemplate).*?\.(?:send|convertAndSend)\s*\(\s*["']([^"']+)["']/g;
    const springDbRegex = /extends\s+(JpaRepository|MongoRepository|CrudRepository|ReactiveMongoRepository)/g;

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
              while ((match = httpRegex.exec(content)) !== null) addDependency(`HTTP API: ${match[1]}`, relativePath);
              while ((match = grpcRegex.exec(content)) !== null) addDependency(`gRPC Method: ${match[1]}`, relativePath);
              while ((match = eventRegex.exec(content)) !== null) addDependency(`Event/Message: ${match[1]}`, relativePath);
              while ((match = dbRegex.exec(content)) !== null) addDependency(`Infrastructure: ${match[1]}`, relativePath);
            }

            if (isJava) {
              while ((match = springFeignRegex.exec(content)) !== null) addDependency(`FeignClient: ${match[1]}`, relativePath);
              while ((match = springHttpRegex.exec(content)) !== null) addDependency(`HTTP API: ${match[1]}`, relativePath);
              while ((match = springEventRegex.exec(content)) !== null) addDependency(`Event/Message (Kafka/Rabbit): ${match[1]}`, relativePath);
              while ((match = springDbRegex.exec(content)) !== null) addDependency(`Database Access: ${match[1]}`, relativePath);
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

    if (dependencies.size === 0) {
       return {
         content: [{ type: "text", text: `✅ No external service dependencies found in ${targetPath}.` }]
       };
    }

    // Format output
    const reportLines = [`Dependencies found in ${targetPath}:\n`];
    for (const [dep, files] of dependencies.entries()) {
      reportLines.push(`- **${dep}**`);
      for (const file of files) {
        reportLines.push(`  - found in: \`${file}\``);
      }
    }

    return {
      content: [{ type: "text", text: reportLines.join('\n') }]
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Failed to analyze dependencies: ${error.message}` }],
      isError: true,
    };
  }
}
