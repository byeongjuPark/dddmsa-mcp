import path from "path";

/**
 * Resolves the given user input path against the base path and ensures it does not escape the base path.
 * This prevents Directory Traversal (Path Traversal) vulnerabilities.
 * @param basePath The absolute root path the operation is locked to (e.g., process.cwd())
 * @param userInputPath The relative or absolute path provided by the user
 * @returns The safely resolved absolute path
 * @throws Error if the resolved path is outside the basePath
 */
export function resolveSafePath(basePath: string, userInputPath: string): string {
    const resolvedPath = path.resolve(basePath, userInputPath);
    
    // Normalize both paths to ensure consistent matching, especially with trailing separators
    const normalizedBase = path.normalize(basePath).replace(/\\/g, '/');
    const normalizedResolved = path.normalize(resolvedPath).replace(/\\/g, '/');
    
    // Check if the resolved path starts with the base path
    if (!normalizedResolved.startsWith(normalizedBase)) {
        throw new Error(`Security Violation: Path traversal detected. Expected path inside '${basePath}', got '${resolvedPath}'`);
    }

    // Alternatively, verify with relative
    const relative = path.relative(basePath, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Security Violation: Path traversal detected. Expected path inside '${basePath}', got '${resolvedPath}'`);
    }

    return resolvedPath;
}
