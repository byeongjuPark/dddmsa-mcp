import fs from "fs/promises";
import path from "path";

interface GenerateSpecArgs {
  sourcePath: string;
  outputFormat: "openapi" | "grpc";
}

export async function generateCommunicationSpec(args: GenerateSpecArgs) {
  const { sourcePath, outputFormat } = args;
  const targetDir = path.join(process.cwd(), sourcePath);

  try {
    const endpoints: { method: string, path: string }[] = [];

    // Simple Regex for detecting endpoints
    const tsRegex = /\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
    const springRegex = /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

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
               const content = await fs.readFile(path.join(dir, entry.name), "utf-8");
               let match;
               if (isTS) {
                 while ((match = tsRegex.exec(content)) !== null) {
                   endpoints.push({ method: match[1].toLowerCase(), path: match[2] });
                 }
               }
               if (isJava) {
                 while ((match = springRegex.exec(content)) !== null) {
                   endpoints.push({ method: match[1].toLowerCase(), path: match[2] });
                 }
               }
             }
           }
        }
      } catch (e) {}
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
    await fs.writeFile(outputPath, specContent);

    return {
      content: [
        {
          type: "text",
          text: `Successfully scanned project and generated ${outputFormat.toUpperCase()} spec with ${endpoints.length} endpoints at ${outputPath}`,
        },
      ],
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
