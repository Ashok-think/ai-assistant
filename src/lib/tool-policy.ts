export type ToolStatus = "succeeded" | "unverified" | "awaiting_user" | "blocked" | "failed" | "cancelled";

export type ToolPolicyDefinition = {
  name: string;
  skillKey: string;
  parameters: Record<string, unknown>;
  requiresConfirmation?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateToolArguments(schema: Record<string, unknown>, value: unknown): string | null {
  if (!record(value)) return "Arguments must be a JSON object.";
  const properties = record(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key !== "string" || !Object.hasOwn(value, key)) return `Missing required argument: ${String(key)}.`;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(properties, key)) return `Unknown argument: ${key}.`;
    const property = properties[key];
    if (!record(property)) return `Unsupported schema for ${key}.`;
    if (!["string", "number", "boolean"].includes(String(property.type))) return `Unsupported argument type for ${key}.`;
    if (typeof entry !== property.type) return `Invalid type for ${key}; expected ${String(property.type)}.`;
    if (typeof entry === "string" && (entry.length > 20000 || (required.includes(key) && !entry.trim()))) return `Invalid length for ${key}.`;
    if (typeof entry === "number" && !Number.isFinite(entry)) return `${key} must be finite.`;
    if (Array.isArray(property.enum) && !property.enum.includes(entry)) return `Invalid value for ${key}.`;
  }
  for (const key of ["id", "index", "x", "y"]) {
    const n = value[key];
    if (n !== undefined && (typeof n !== "number" || !Number.isSafeInteger(n) || n < (key === "id" ? 1 : 0))) return `Invalid ${key}.`;
  }
  return null;
}

export function toolPolicyBlock(tool: ToolPolicyDefinition, enabledSkills: ReadonlySet<string>): string | null {
  if (!enabledSkills.has(tool.skillKey)) return `The ${tool.skillKey} skill is disabled. No action was performed.`;
  if (tool.skillKey === "pc_browser" || tool.skillKey === "android") {
    return "Device execution is blocked until authenticated companion pairing is implemented. The cloud server is not your laptop. No device action was performed.";
  }
  if (tool.requiresConfirmation || ["remember_fact", "log_mood"].includes(tool.name)) {
    return "This action requires authenticated, argument-bound approval. That approval service is not configured; nothing was saved or executed. Use the dedicated review screen instead.";
  }
  return null;
}

export function parseToolArguments(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

export function taskOutcome(statuses: ToolStatus[]): "succeeded" | "blocked" | "failed" | "unverified" {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("blocked")) return "blocked";
  if (!statuses.length || statuses.some((status) => status !== "succeeded")) return "unverified";
  return "succeeded";
}
