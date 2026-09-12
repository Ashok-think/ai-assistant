export type TtsProvider = "elevenlabs" | "gemini" | "openrouter-fish" | "custom";

export type TtsProviderPolicy = {
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  streaming: boolean;
};

export type TtsMetric = {
  provider: string;
  ok: boolean;
  timeToFirstAudioMs: number | null;
  totalAudioLatencyMs: number;
  bytes: number;
  error?: string;
  measuredAt: string;
};

const DEFAULTS: Record<TtsProvider, TtsProviderPolicy> = {
  openrouter-fish: { enabled: true, priority: 1, timeoutMs: 12000, streaming: false },
  gemini: { enabled: true, priority: 2, timeoutMs: 12000, streaming: false },
  elevenlabs: { enabled: true, priority: 3, timeoutMs: 12000, streaming: true },
  custom: { enabled: true, priority: 4, timeoutMs: 12000, streaming: false },
};

const metrics: TtsMetric[] = [];

export function getTtsPolicies(value?: unknown): Record<TtsProvider, TtsProviderPolicy> {
  const input = value && typeof value === "object" ? value as Partial<Record<TtsProvider, Partial<TtsProviderPolicy>>> : {};
  return Object.fromEntries((Object.keys(DEFAULTS) as TtsProvider[]).map((provider) => [provider, {
    ...DEFAULTS[provider], ...input[provider],
    priority: Math.max(1, Number(input[provider]?.priority ?? DEFAULTS[provider].priority)),
    timeoutMs: Math.max(1000, Math.min(60000, Number(input[provider]?.timeoutMs ?? DEFAULTS[provider].timeoutMs))),
  }])) as Record<TtsProvider, TtsProviderPolicy>;
}

export function orderTtsProviders(policies: Record<TtsProvider, TtsProviderPolicy>, preferred?: string): TtsProvider[] {
  const providers = Object.keys(policies) as TtsProvider[];
  return providers.filter((provider) => policies[provider].enabled && (preferred === "auto" || !preferred || preferred === provider))
    .sort((a, b) => policies[a].priority - policies[b].priority);
}

export function recordTtsMetric(metric: TtsMetric) {
  metrics.push(metric);
  if (metrics.length > 100) metrics.shift();
}

export function getRecentTtsMetrics() {
  return metrics.slice(-30).reverse();
}

export function adaptivePenalty(provider: string) {
  const recent = metrics.filter((metric) => metric.provider === provider).slice(-5);
  if (!recent.length) return 0;
  const failures = recent.filter((metric) => !metric.ok).length;
  const latency = recent.reduce((sum, metric) => sum + metric.totalAudioLatencyMs, 0) / recent.length;
  return failures * 10000 + Math.min(latency, 30000);
}

export function defaultTtsPolicies() { return getTtsPolicies(); }
export type { TtsProviderPolicy as TtsPolicy };
