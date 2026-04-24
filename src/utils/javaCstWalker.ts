import { parse } from "java-parser";

interface ASTExtraction {
    imports: string[];
    endpoints: { method: string, path: string, line?: number }[];
    dependencies: string[];
}

export function extractJavaDataFromAST(content: string): ASTExtraction {
    const ast = parse(content);
    
    const extraction: ASTExtraction = {
        imports: [],
        endpoints: [],
        dependencies: []
    };

    let classLevelPath = "";

    function walk(node: any) {
        if (!node || typeof node !== 'object') return;

        // Extract Imports
        if (node.name === "importDeclaration") {
            const pkgNode = node.children?.packageOrTypeName?.[0];
            if (pkgNode?.children?.Identifier) {
                const importPath = pkgNode.children.Identifier.map((i: any) => i.image).join('.');
                extraction.imports.push(importPath);
            }
        }

        // Extract Annotations (Endpoints & Feign)
        if (node.name === "annotation") {
            const aName = node.children?.typeName?.[0]?.children?.Identifier?.[0]?.image;
            if (aName) {
                // Feign Client
                if (aName === 'FeignClient') {
                    const value = extractAnnotationStringValue(node);
                    if (value) extraction.dependencies.push(`FeignClient: ${value}`);
                }
                // RequestMapping class-level
                else if (aName === 'RequestMapping') {
                    const value = extractAnnotationStringValue(node);
                    if (value) classLevelPath = value;
                }
                // Method mappings
                else if (['GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping'].includes(aName)) {
                    const method = aName.replace("Mapping", "").toLowerCase();
                    const value = extractAnnotationStringValue(node);
                    
                    const methodPath = value || "";
                    let fullPath = (classLevelPath + (classLevelPath.endsWith('/') || methodPath.startsWith('/') || methodPath === '' ? '' : '/') + methodPath).replace(/\/\/+/g, '/');
                    if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;
                    if (fullPath.endsWith('/') && fullPath.length > 1) fullPath = fullPath.slice(0, -1);

                    extraction.endpoints.push({ method, path: fullPath, line: node.location?.startLine });
                }
            }
        }

        // Extract Methods (RestTemplate, KafkaTemplate calls)
        if (node.name === "methodInvocationSuffix") {
             const mName = node.children?.Identifier?.[0]?.image;
             if (mName && ['getForObject', 'postForEntity', 'exchange', 'get', 'post', 'send', 'convertAndSend'].includes(mName)) {
                 const argExp = node.children?.argumentList?.[0]?.children?.expression?.[0];
                 const strLiteral = extractStringLiteralFromExpression(argExp);
                 if (strLiteral) {
                     if (strLiteral.startsWith('http')) {
                         extraction.dependencies.push(`HTTP API: ${strLiteral}`);
                     } else {
                         extraction.dependencies.push(`Event/Message (Kafka/Rabbit): ${strLiteral}`);
                     }
                 }
             }
        }

        // Extract tokens directly for strings
        if (node.image && typeof node.image === 'string') {
            const img = node.image;
            if (img.startsWith('"http://') || img.startsWith('"https://')) {
                extraction.dependencies.push(`HTTP API: ${img.replace(/["']/g, '')}`);
            }
        }

        // Extract Database interfaces
        if (node.name === "interfaceExtends" || node.name === "classExtends") {
             const types = node.name === "interfaceExtends" 
                 ? node.children?.interfaceTypeList?.[0]?.children?.classOrInterfaceType || []
                 : node.children?.classType?.[0] ? [node.children.classType[0]] : [];
                 
             types.forEach((t: any) => {
                  const extendsName = t.children?.Identifier?.[0]?.image || t.children?.classOrInterfaceType?.[0]?.children?.Identifier?.[0]?.image;
                  if (extendsName && extendsName.includes('Repository')) {
                       extraction.dependencies.push(`Database Access: ${extendsName}`);
                  }
             });
        }

        for (const key of Object.keys(node)) {
            if (key === 'location' || key === 'parent') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) walk(c);
            } else {
                walk(child);
            }
        }
    }

    walk(ast);
    return extraction;
}

function extractAnnotationStringValue(node: any): string | null {
    try {
        const elementVal = node.children?.elementValue?.[0]?.children?.expression?.[0];
        let str = extractStringLiteralFromExpression(elementVal);
        if (str) return str.replace(/["']/g, '');

        const pairs = node.children?.elementValuePairs?.[0]?.children?.elementValuePair || [];
        for (const pair of pairs) {
            const exp = pair.children?.elementValue?.[0]?.children?.expression?.[0];
            const val = extractStringLiteralFromExpression(exp);
            if (val) return val.replace(/["']/g, '');
        }
    } catch(e) {}
    return null;
}

function extractStringLiteralFromExpression(expNode: any): string | null {
    if (!expNode) return null;
    let current = expNode;
    // Drill down expression tree
    if (current.children?.ternaryExpression) current = current.children.ternaryExpression[0];
    if (current.children?.binaryExpression) current = current.children.binaryExpression[0];
    if (current.children?.unaryExpression) current = current.children.unaryExpression[0];
    if (current.children?.primary) current = current.children.primary[0];
    if (current.children?.primaryPrefix) current = current.children.primaryPrefix[0];
    if (current.children?.literal) current = current.children.literal[0];
    if (current.children?.StringLiteral) {
        return current.children.StringLiteral[0].image.replace(/["']/g, '');
    }
    return null;
}
