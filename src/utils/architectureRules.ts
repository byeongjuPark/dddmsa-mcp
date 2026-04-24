import fs from "fs/promises";
import path from "path";

export interface ArchitectureRule {
  id: string;
  fromLayer: string;
  disallowLayers?: string[];
  disallowImports?: string[];
  disallowPathPatterns?: string[];
  severity: "error" | "warning";
  recommendation?: string;
}

export interface ArchitectureConfig {
  layers: Record<string, string[]>;
  rules: ArchitectureRule[];
  ignorePaths: string[];
}

interface UserArchitectureConfig {
  layers?: Record<string, string[]>;
  rules?: Array<Partial<ArchitectureRule> & Pick<ArchitectureRule, "id" | "fromLayer">>;
  ignorePaths?: string[];
}

export const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfig = {
  layers: {
    domain: ["domain"],
    application: ["application"],
    infrastructure: ["infrastructure"],
    presentation: ["presentation"],
  },
  rules: [
    {
      id: "DDD-001",
      fromLayer: "domain",
      disallowLayers: ["application", "infrastructure", "presentation"],
      severity: "error",
      recommendation: "Move framework and orchestration dependencies out of the domain layer.",
    },
    {
      id: "DDD-002",
      fromLayer: "application",
      disallowLayers: ["infrastructure", "presentation"],
      severity: "error",
      recommendation: "Depend on application ports/interfaces instead of infrastructure or presentation code.",
    },
    {
      id: "DDD-003",
      fromLayer: "domain",
      disallowImports: [
        "@nestjs/*",
        "express",
        "typeorm",
        "sequelize",
        "mongoose",
        "org.springframework.*",
        "jakarta.persistence.*",
        "javax.persistence.*",
      ],
      severity: "error",
      recommendation: "Keep domain models free from framework, persistence, and transport dependencies.",
    },
    {
      id: "DDD-004",
      fromLayer: "presentation",
      disallowLayers: ["infrastructure"],
      disallowPathPatterns: ["*repository*", "*Repository*"],
      severity: "error",
      recommendation: "Route presentation code through application use cases instead of repositories.",
    },
    {
      id: "MSA-001",
      fromLayer: "domain",
      disallowPathPatterns: ["contexts/*/domain/entities/*", "*/contexts/*/domain/entities/*", "services/*/domain/entities/*", "*/services/*/domain/entities/*"],
      severity: "warning",
      recommendation: "Avoid importing entities from another bounded context; depend on contracts or IDs instead.",
    },
  ],
  ignorePaths: ["node_modules", "dist", "build", "coverage", ".git", ".gradle", "target"],
};

export async function loadArchitectureConfig(rootDir: string): Promise<ArchitectureConfig> {
  const configPath = path.join(rootDir, ".dddmsa.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as UserArchitectureConfig;

    return {
      layers: parsed.layers ?? DEFAULT_ARCHITECTURE_CONFIG.layers,
      rules: normalizeRules(parsed.rules ?? DEFAULT_ARCHITECTURE_CONFIG.rules),
      ignorePaths: parsed.ignorePaths ?? DEFAULT_ARCHITECTURE_CONFIG.ignorePaths,
    };
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw new Error(`Failed to load .dddmsa.json: ${error.message}`);
    }
    return DEFAULT_ARCHITECTURE_CONFIG;
  }
}

export function getLayerForPath(relativePath: string, config: ArchitectureConfig): string | undefined {
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/");

  for (const [layer, aliases] of Object.entries(config.layers)) {
    if (aliases.some((alias) => segments.includes(alias))) {
      return layer;
    }
  }

  return undefined;
}

export function shouldIgnorePath(relativePath: string, config: ArchitectureConfig): boolean {
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/");

  return config.ignorePaths.some((ignoredPath) => {
    const normalizedIgnored = normalizePath(ignoredPath);
    return normalized === normalizedIgnored || normalized.startsWith(`${normalizedIgnored}/`) || segments.includes(normalizedIgnored);
  });
}

export function findImportLayer(importPath: string, config: ArchitectureConfig): string | undefined {
  const normalized = normalizePath(importPath);
  const segments = normalized.split("/");

  for (const [layer, aliases] of Object.entries(config.layers)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizePath(alias);
      if (
        normalized.includes(`.${normalizedAlias}.`) ||
        normalized.endsWith(`.${normalizedAlias}`) ||
        segments.includes(normalizedAlias)
      ) {
        return layer;
      }
    }
  }

  return undefined;
}

export function matchesAnyPattern(value: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => wildcardToRegExp(pattern).test(value));
}

function normalizeRules(rules: UserArchitectureConfig["rules"]): ArchitectureRule[] {
  return (rules ?? []).map((rule) => ({
    id: rule.id,
    fromLayer: rule.fromLayer,
    disallowLayers: rule.disallowLayers,
    disallowImports: rule.disallowImports,
    disallowPathPatterns: rule.disallowPathPatterns,
    severity: rule.severity ?? "error",
    recommendation: rule.recommendation,
  }));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
