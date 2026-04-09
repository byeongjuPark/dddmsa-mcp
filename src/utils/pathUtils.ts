import path from "path";
import fs from "fs";

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
    
    const normalizedBaseC = normalizedBase.endsWith('/') ? normalizedBase : normalizedBase + '/';
    const normalizedResolvedC = normalizedResolved.endsWith('/') ? normalizedResolved : normalizedResolved + '/';

    // Check if the resolved path starts with the base path
    if (!normalizedResolvedC.startsWith(normalizedBaseC)) {
        throw new Error(`Security Violation: Path traversal detected. Expected path inside '${basePath}', got '${resolvedPath}'`);
    }

    try {
        if (fs.existsSync(resolvedPath)) {
            const realPath = fs.realpathSync(resolvedPath);
            const normalizedReal = path.normalize(realPath).replace(/\\/g, '/');
            const normalizedRealC = normalizedReal.endsWith('/') ? normalizedReal : normalizedReal + '/';
            if (!normalizedRealC.startsWith(normalizedBaseC)) {
                throw new Error(`Security Violation: Symlink escapes the base directory. Expected path inside '${basePath}', got '${realPath}'`);
            }
        }
    } catch (e) {
        // file doesn't exist yet, that's okay
    }

    const allowListEnv = process.env.WORKSPACE_ALLOWLIST;
    if (allowListEnv) {
        const allowedPaths = allowListEnv.split(',').map(p => {
             const np = path.normalize(p.trim()).replace(/\\/g, '/');
             return np.endsWith('/') ? np : np + '/';
        });
        const isAllowed = allowedPaths.some(allowed => normalizedResolvedC.startsWith(allowed));
        if (!isAllowed) {
            throw new Error(`Security Violation: Path is not within the WORKSPACE_ALLOWLIST bounds.`);
        }
    }

    return resolvedPath;
}
