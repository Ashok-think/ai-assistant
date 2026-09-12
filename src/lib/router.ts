/**
 * TOKEN ROUTER
 * ------------
 * Decides which model handles each request:
 *  - estimates token usage
 *  - classifies task complexity (fast vs smart)
 *  - respects daily budget, free-only mode and forced mode
 *  - picks the best available provider (env keys > BYOK settings)
 *  - falls back to local (Ollama) and finally the built-in offline persona engine
 *  - logs every call (tokens, cost, latency) for the usage dashboard
 */
import { db } from "@/db";
import { usageLogs, settings as settingsTable } from "@/db/schema";
import { gte, sql } from "drizzle-orm";

export type Tier = "fast" | "smart" | "local" | "offline";
export type ProviderId = "gateway" | "openai" | "groq" | "openrouter" | "gemini" | "ollama" | "offline" | "tokenrouter" | "qwen" | "aihub" | "custom";

export type ModelSpec = {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  inPer1M: number; // USD per 1M input tokens
  outPer1M: number;
  free: boolean;
  supportsTools: boolean;
};

export type RouteDecision = {
  tier: Tier;
  spec: ModelSpec;
  apiKey: string | null;
  reason: string;
  complexity: number; // 0..1
  estimatedInputTokens: number;
  budgetUsedUsd: number;
  budgetUsd: number;
};

type Settings = typeof settingsTable.$inferSelect;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const SMART_HINTS = [
  "essay", "code", "debug", "explain", "why", "compare", "analy", "plan", "itinerary", "strategy",
  "write a", "story", "poem", "summar", "review", "refactor", "architecture", "prove", "derive",
  "step by step", "detailed", "research", "trip", "business", "design", "optimize", "translate this",
  "homework", "solve", "algorithm", "long", "thesis", "proposal",
];

export function classifyComplexity(message: string, historyChars: number): number {
  const m = message.toLowerCase();
  let score = 0;
  score += Math.min(0.35, message.length / 1200); // long prompts → smarter model
  const hints = SMART_HINTS.filter((h) => m.includes(h)).length;
  score += Math.min(0.45, hints * 0.15);
  if (/```|\bfunction\b|\bclass\b|\bimport\b|\bdef\b/.test(message)) score += 0.25;
  if ((m.match(/\?/g) ?? []).length >= 2) score += 0.1;
  if (/\b(and then|after that|also|then)\b/.test(m)) score += 0.1; // multi-step
  score += Math.min(0.1, historyChars / 40000);
  // quick chit-chat signals → cheaper
  if (message.length < 40 && !hints) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

function env(name: string, fallback?: string | null) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback ?? null;
}

export function buildCatalog(s: Settings): { spec: ModelSpec; key: string | null; tier: Tier }[] {
  const openaiKey = env("OPENAI_API_KEY", s.openaiKey);
  const groqKey = env("GROQ_API_KEY", s.groqKey);
  const orKey = env("OPENROUTER_API_KEY", s.openrouterKey);
  const ollama = env("OLLAMA_BASE_URL", s.ollamaUrl);
  // Optional per-provider overrides from Settings (blank → sensible default).
  const clean = (u: string | null | undefined, fallback: string) => (u && u.trim() ? u.trim().replace(/\/+$/, "") : fallback);

  const list: { spec: ModelSpec; key: string | null; tier: Tier }[] = [];
  if (openaiKey) {
    const base = clean(env("OPENAI_BASE_URL", s.openaiBaseUrl), "https://api.openai.com/v1");
    list.push({
      tier: "fast", key: openaiKey,
      spec: { provider: "openai", model: env("FAST_MODEL", s.openaiFastModel) ?? "gpt-4o-mini", baseUrl: base, inPer1M: 0.15, outPer1M: 0.6, free: false, supportsTools: true },
    });
    list.push({
      tier: "smart", key: openaiKey,
      spec: { provider: "openai", model: env("SMART_MODEL", s.openaiSmartModel) ?? "gpt-4o", baseUrl: base, inPer1M: 2.5, outPer1M: 10, free: false, supportsTools: true },
    });
  }
  if (groqKey) {
    const base = clean(env("GROQ_BASE_URL", s.groqBaseUrl), "https://api.groq.com/openai/v1");
    list.push({
      tier: "fast", key: groqKey,
      spec: { provider: "groq", model: env("GROQ_FAST_MODEL", s.groqFastModel) ?? "llama-3.1-8b-instant", baseUrl: base, inPer1M: 0.05, outPer1M: 0.08, free: true, supportsTools: true },
    });
    list.push({
      tier: "smart", key: groqKey,
      spec: { provider: "groq", model: env("GROQ_SMART_MODEL", s.groqSmartModel) ?? "llama-3.3-70b-versatile", baseUrl: base, inPer1M: 0.59, outPer1M: 0.79, free: true, supportsTools: true },
    });
  }
  if (orKey) {
    const base = clean(env("OPENROUTER_BASE_URL", s.openrouterBaseUrl), "https://openrouter.ai/api/v1");
    list.push({
      tier: "fast", key: orKey,
      // Default free model id kept current (OpenRouter retires :free ids periodically). If this
      // 404s, set OPENROUTER_FAST_MODEL / Settings → a live id. The provider falls through anyway.
      spec: { provider: "openrouter", model: /fish[-_ ]?audio/i.test(env("OPENROUTER_FAST_MODEL", s.openrouterFastModel) ?? "") ? "meta-llama/llama-3.3-70b-instruct:free" : (env("OPENROUTER_FAST_MODEL", s.openrouterFastModel) ?? "meta-llama/llama-3.3-70b-instruct:free"), baseUrl: base, inPer1M: 0, outPer1M: 0, free: true, supportsTools: false },
    });
    list.push({
      tier: "smart", key: orKey,
      spec: { provider: "openrouter", model: /fish[-_ ]?audio/i.test(env("OPENROUTER_SMART_MODEL", s.openrouterSmartModel) ?? "") ? "anthropic/claude-3.5-sonnet" : (env("OPENROUTER_SMART_MODEL", s.openrouterSmartModel) ?? "anthropic/claude-3.5-sonnet"), baseUrl: base, inPer1M: 3, outPer1M: 15, free: false, supportsTools: true },
    });
  }
  // OpenAI-compatible BYOK providers (key + base URL + model id, like jarvish 1.0)
  const compat = [
    { id: "tokenrouter" as const, key: env("TOKENROUTER_API_KEY", s.tokenrouterKey), base: env("TOKENROUTER_BASE_URL", s.tokenrouterBaseUrl), model: env("TOKENROUTER_MODEL", s.tokenrouterModel), defaultBase: "https://api.tokenrouter.io/v1", defaultModel: "openai/gpt-5-mini" },
    { id: "qwen" as const, key: env("QWEN_API_KEY", s.qwenKey), base: env("QWEN_BASE_URL", s.qwenBaseUrl), model: env("QWEN_MODEL", s.qwenModel), defaultBase: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
    { id: "aihub" as const, key: env("AIHUB_API_KEY", s.aihubKey), base: env("AIHUB_BASE_URL", s.aihubBaseUrl), model: env("AIHUB_MODEL", s.aihubModel), defaultBase: "https://aihubmix.com/v1", defaultModel: "gpt-4o-mini" },
    { id: "custom" as const, key: env("CUSTOM_LLM_API_KEY", s.customKey), base: env("CUSTOM_LLM_BASE_URL", s.customBaseUrl), model: env("CUSTOM_LLM_MODEL", s.customModel), defaultBase: "https://openrouter.ai/api/v1", defaultModel: "gpt-4o-mini" },
  ];
  for (const p of compat) {
    if (!p.key) continue;
    const rawBase = (p.base ?? p.defaultBase).trim();
    const baseUrl = (rawBase || p.defaultBase).replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/models$/, "");
    const model = (p.model ?? p.defaultModel).trim();
    // single configured model serves both tiers
    list.push({ tier: "fast", key: p.key, spec: { provider: p.id, model, baseUrl, inPer1M: 0, outPer1M: 0, free: false, supportsTools: true } });
    list.push({ tier: "smart", key: p.key, spec: { provider: p.id, model, baseUrl, inPer1M: 0, outPer1M: 0, free: false, supportsTools: true } });
  }
  if (ollama) {
    list.push({
      tier: "local", key: null,
      spec: { provider: "ollama", model: env("OLLAMA_MODEL", s.ollamaModel) ?? "llama3.2", baseUrl: `${ollama.replace(/\/$/, "")}/v1`, inPer1M: 0, outPer1M: 0, free: true, supportsTools: true },
    });
  }
  const geminiKey = env("GEMINI_API_KEY", s.geminiKey);
  if (geminiKey) {
    const gbase = "https://generativelanguage.googleapis.com/v1beta/openai";
    list.push({
      tier: "fast", key: geminiKey,
      spec: { provider: "gemini" as ProviderId, model: env("GEMINI_FAST_MODEL", s.geminiFastModel) ?? "gemini-2.5-flash", baseUrl: gbase, inPer1M: 0, outPer1M: 0, free: true, supportsTools: true },
    });
    list.push({
      tier: "smart", key: geminiKey,
      spec: { provider: "gemini" as ProviderId, model: env("GEMINI_SMART_MODEL", s.geminiSmartModel) ?? "gemini-2.5-pro", baseUrl: gbase, inPer1M: 1.25, outPer1M: 10, free: false, supportsTools: true },
    });
  }
  list.push(
    { tier: "fast", key: null, spec: { provider: "gateway", model: "google/gemini-3.5-flash-lite", baseUrl: "", inPer1M: 0.3, outPer1M: 2.5, free: false, supportsTools: true } },
    { tier: "smart", key: null, spec: { provider: "gateway", model: "google/gemini-3.8-flash", baseUrl: "", inPer1M: 0.75, outPer1M: 3.75, free: false, supportsTools: true } },
  );
  return list;
}

export const OFFLINE_SPEC: ModelSpec = {
  provider: "offline", model: "persona-engine-v1", baseUrl: "", inPer1M: 0, outPer1M: 0, free: true, supportsTools: true,
};

export async function todaySpend(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageLogs.costUsd}), 0)` })
    .from(usageLogs)
    .where(gte(usageLogs.createdAt, new Date(startMs)))
    .all();
  return Number(row?.total ?? 0);
}

export async function route(opts: {
  settings: Settings;
  message: string;
  historyChars: number;
  systemPromptChars: number;
  forceTier?: Tier;
}): Promise<RouteDecision> {
  return (await routeChain(opts))[0];
}

/**
 * The primary pick plus every provider worth trying after it, ending with the offline engine.
 *
 * Picking one provider and waiting out its timeout was the single worst source of slow replies:
 * a rate-limited key meant a full minute of nothing before the offline fallback spoke. Walking a
 * chain turns that into the couple of seconds it takes to get a 429.
 */
export async function routeChain(opts: {
  settings: Settings;
  message: string;
  historyChars: number;
  systemPromptChars: number;
  forceTier?: Tier;
  selectedProvider?: string | null;
  selectedModel?: string | null;
}): Promise<RouteDecision[]> {
  const { settings: s } = opts;
  const complexity = classifyComplexity(opts.message, opts.historyChars);
  const estimatedInputTokens = estimateTokens(opts.message) + Math.ceil((opts.historyChars + opts.systemPromptChars) / 4);
  const spent = await todaySpend();
  const catalog = buildCatalog(s);
  const reasons: string[] = [];

  const selectedProvider = opts.selectedProvider ?? (s.thinkingModelMode === "selected" ? s.thinkingProvider : s.chatModelMode === "selected" ? s.chatProvider : null);
  const selectedModel = opts.selectedModel ?? (s.thinkingModelMode === "selected" ? s.thinkingModel : s.chatModelMode === "selected" ? s.chatModel : null);
  if (selectedProvider && selectedModel) {
    const selected = catalog.find((entry) => entry.spec.provider === selectedProvider && entry.spec.model === selectedModel);
    if (selected) {
      return [{ tier: selected.tier, spec: selected.spec, apiKey: selected.key, reason: `selected thinking model ${selectedProvider}/${selectedModel}`, complexity, estimatedInputTokens, budgetUsedUsd: spent, budgetUsd: s.dailyBudgetUsd }, { tier: "offline", spec: OFFLINE_SPEC, apiKey: null, reason: "selected thinking model failed → offline persona engine", complexity, estimatedInputTokens, budgetUsedUsd: spent, budgetUsd: s.dailyBudgetUsd }];
    }
    reasons.push(`selected thinking model unavailable: ${selectedProvider}/${selectedModel}`);
  }

  let wanted: Tier = complexity >= 0.45 ? "smart" : "fast";
  reasons.push(`complexity ${(complexity * 100).toFixed(0)}% → ${wanted}`);

  const mode = opts.forceTier ?? (s.routerMode as Tier | "auto");
  if (mode !== "auto") {
    wanted = mode;
    reasons.push(`forced ${mode}`);
  }

  let pool = wanted === "offline" ? [] : wanted === "local" ? catalog.filter((entry) => entry.tier === "local") : catalog;
  if (s.freeOnlyMode) {
    pool = pool.filter((c) => c.spec.free);
    reasons.push("free-only mode");
  }
  const overBudget = spent >= s.dailyBudgetUsd;
  if (overBudget) {
    pool = pool.filter((c) => c.spec.free);
    reasons.push(`daily budget $${s.dailyBudgetUsd} reached → free/local only`);
  }
  if (s.lowPowerMode && wanted === "smart") {
    wanted = "fast";
    reasons.push("low power mode → fast");
  }

  const order: Tier[] = wanted === "smart" ? ["smart", "fast", "local"] : wanted === "local" ? ["local", "fast", "smart"] : ["fast", "smart", "local"];
  const base = { complexity, estimatedInputTokens, budgetUsedUsd: spent, budgetUsd: s.dailyBudgetUsd };
  const chain: RouteDecision[] = [];
  const seen = new Set<string>();
  // Prefer cheapest inside a tier, and tiers in preference order.
  for (const t of order) {
    const candidates = pool.filter((c) => c.tier === t).sort((a, b) => a.spec.inPer1M + a.spec.outPer1M - (b.spec.inPer1M + b.spec.outPer1M));
    for (const c of candidates) {
      const sig = `${c.spec.provider}:${c.spec.model}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const rs = [...reasons];
      if (t !== wanted) rs.push(`no ${wanted} model available → ${t}`);
      if (chain.length) rs.push(`fallback #${chain.length}`);
      chain.push({ tier: t, spec: c.spec, apiKey: c.key, reason: rs.join("; "), ...base });
    }
  }
  chain.push({
    tier: "offline",
    spec: OFFLINE_SPEC,
    apiKey: null,
    reason: [...reasons, chain.length ? "every provider failed → offline persona engine" : "no provider configured → offline persona engine"].join("; "),
    ...base,
  });
  return chain;
}

export function costFor(spec: ModelSpec, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * spec.inPer1M + (tokensOut / 1_000_000) * spec.outPer1M;
}

export async function logUsage(d: { decision: RouteDecision; tokensIn: number; tokensOut: number; latencyMs: number }) {
  const cost = costFor(d.decision.spec, d.tokensIn, d.tokensOut);
  await db.insert(usageLogs).values({
    provider: d.decision.spec.provider,
    model: d.decision.spec.model,
    tier: d.decision.tier,
    reason: d.decision.reason,
    tokensIn: d.tokensIn,
    tokensOut: d.tokensOut,
    costUsd: cost,
    latencyMs: d.latencyMs,
  }).run();
  return cost;
}
