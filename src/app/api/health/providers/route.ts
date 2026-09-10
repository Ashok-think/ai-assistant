import { getSettings } from "@/lib/bootstrap";
import { buildCatalog } from "@/lib/router";

export const dynamic = "force-dynamic";

type ProbeResult = {
  provider: string;
  tier: string;
  model: string;
  ok: boolean;
  status: number | string;
  latencyMs: number;
};

/**
 * Live probe of every configured provider so the user can see which of their APIs actually
 * work. Each probe is cheap: an OpenAI-compatible `GET /models` for LLM providers, a voices
 * list for ElevenLabs, and a models list for Gemini. Deduplicated by provider.
 */
export async function GET() {
  const st = await getSettings();
  const catalog = buildCatalog(st);

  // One probe per unique LLM provider (not per tier).
  const seen = new Set<string>();
  const llmTargets = catalog.filter((c) => {
    if (seen.has(c.spec.provider)) return false;
    seen.add(c.spec.provider);
    return true;
  });

  const probes: Promise<ProbeResult>[] = llmTargets.map(async (c) => {
    const started = Date.now();
    try {
      if (c.spec.provider === "ollama") {
        const r = await fetch(`${c.spec.baseUrl}/models`, { signal: AbortSignal.timeout(8000) });
        return res(c, r.ok, r.status, started);
      }
      const r = await fetch(`${c.spec.baseUrl}/models`, {
        headers: c.key ? { Authorization: `Bearer ${c.key}` } : {},
        signal: AbortSignal.timeout(12000),
      });
      return res(c, r.ok, r.status, started);
    } catch (e) {
      return res(c, false, (e as Error).name === "TimeoutError" ? "timeout" : "error", started);
    }
  });

  // ElevenLabs TTS probe.
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() || st.elevenLabsKey?.trim();
  const ttsProbes: Promise<ProbeResult>[] = [];
  if (elevenKey) {
    ttsProbes.push(
      (async () => {
        const started = Date.now();
        try {
          const r = await fetch("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": elevenKey },
            signal: AbortSignal.timeout(12000),
          });
          return { provider: "elevenlabs", tier: "tts", model: "voices", ok: r.ok, status: r.status, latencyMs: Date.now() - started };
        } catch (e) {
          return { provider: "elevenlabs", tier: "tts", model: "voices", ok: false, status: (e as Error).name === "TimeoutError" ? "timeout" : "error", latencyMs: Date.now() - started };
        }
      })(),
    );
  }

  // Gemini TTS probe (models list on the same key).
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || st.geminiKey?.trim();
  if (geminiKey) {
    ttsProbes.push(
      (async () => {
        const started = Date.now();
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
            signal: AbortSignal.timeout(12000),
          });
          return { provider: "gemini", tier: "tts+llm", model: "models", ok: r.ok, status: r.status, latencyMs: Date.now() - started };
        } catch (e) {
          return { provider: "gemini", tier: "tts+llm", model: "models", ok: false, status: (e as Error).name === "TimeoutError" ? "timeout" : "error", latencyMs: Date.now() - started };
        }
      })(),
    );
  }

  const results = await Promise.all([...probes, ...ttsProbes]);
  return Response.json({
    checkedAt: new Date().toISOString(),
    anyConfigured: results.length > 0,
    results,
  });
}

function res(
  c: { spec: { provider: string; model: string }; tier: string },
  ok: boolean,
  status: number | string,
  started: number,
): ProbeResult {
  return { provider: c.spec.provider, tier: c.tier, model: c.spec.model, ok, status, latencyMs: Date.now() - started };
}
