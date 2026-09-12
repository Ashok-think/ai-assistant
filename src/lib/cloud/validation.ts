type Field = { type: "text" | "uuid" | "number"; required?: boolean; max?: number; min?: number; values?: readonly string[] };
type Entity = { columns: string; owner: "id" | "user_id"; fields?: Record<string, Field> };
export const entities: Record<string, Entity> = {
  profiles: { owner: "id", columns: "id,display_name,created_at,updated_at", fields: { display_name: { type: "text", max: 100 } } },
  conversations: { owner: "user_id", columns: "id,title,character_profile_id,created_at,updated_at", fields: { title: { type: "text", required: true, max: 200 }, character_profile_id: { type: "uuid" } } },
  messages: { owner: "user_id", columns: "id,conversation_id,role,content,created_at,updated_at", fields: { conversation_id: { type: "uuid", required: true }, content: { type: "text", required: true, max: 100000 } } },
  memories: { owner: "user_id", columns: "id,content,kind,importance,source,created_at,updated_at", fields: { content: { type: "text", required: true, max: 10000 }, kind: { type: "text", values: ["fact", "preference", "goal", "event", "person"] }, importance: { type: "number", min: 1, max: 5 } } },
  character_profiles: { owner: "user_id", columns: "id,name,personality,renderer,created_at,updated_at", fields: { name: { type: "text", required: true, max: 100 }, personality: { type: "text", max: 10000 }, renderer: { type: "text", values: ["unconfigured", "live2d", "vrm", "talking_video"] } } },
  voice_profiles: { owner: "user_id", columns: "id,name,provider_connection_id,voice_id,speed,language,created_at,updated_at", fields: { name: { type: "text", required: true, max: 100 }, provider_connection_id: { type: "uuid" }, voice_id: { type: "text", max: 200 }, speed: { type: "number", min: 0.75, max: 1.5 }, language: { type: "text", values: ["en", "te", "hi", "hinglish"] } } },
  tasks: { owner: "user_id", columns: "id,goal,status,created_at,updated_at" },
  task_steps: { owner: "user_id", columns: "id,task_id,position,tool_name,status,attempts,created_at,updated_at" },
  approvals: { owner: "user_id", columns: "id,task_step_id,status,expires_at,decided_at,created_at" },
  devices: { owner: "user_id", columns: "id,name,platform,status,last_seen_at,created_at" },
  provider_connections: { owner: "user_id", columns: "id,name,provider,model_id,voice_id,capabilities,priority,status,created_at" },
  automations: { owner: "user_id", columns: "id,name,schedule,enabled,created_at" },
  audit_logs: { owner: "user_id", columns: "id,action,entity_type,entity_id,created_at" },
};
export const isUUID = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function getEntity(name: string): Entity | undefined { return Object.hasOwn(entities, name) ? entities[name] : undefined; }
export function validateInput(entity: string, value: unknown, partial = false): Record<string, unknown> {
  const spec = getEntity(entity);
  if (!spec?.fields) throw new Error("This entity is read-only.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length === 0) throw new Error("Provide at least one field.");
  for (const key of Object.keys(input)) if (!Object.hasOwn(spec.fields, key)) throw new Error(`Unsupported field: ${key}`);
  const output: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(spec.fields)) {
    const raw = input[key];
    if (raw === undefined) { if (!partial && rule.required) throw new Error(`${key} is required.`); continue; }
    if (raw === null && !rule.required && rule.type === "uuid") { output[key] = null; continue; }
    if (rule.type === "uuid") { if (!isUUID(raw)) throw new Error(`${key} must be a UUID.`); }
    else if (rule.type === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < rule.min! || raw > rule.max! || (key === "importance" && !Number.isInteger(raw))) throw new Error(`${key} is out of range.`);
    } else {
      if (typeof raw !== "string" || (rule.required && !raw.trim()) || (rule.max !== undefined && raw.length > rule.max) || (rule.values && !rule.values.includes(raw))) throw new Error(`${key} is invalid.`);
    }
    output[key] = typeof raw === "string" ? raw.trim() : raw;
  }
  return output;
}
