import { getSettings } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * REAL ElevenLabs diagnostic.
 *
 * Makes an actual server-side request with the `xi-api-key` header and reports exactly what
 * happened — HTTP status, error category, whether audio came back, latency. The API secret is
 * NEVER logged or returned. This is the ground truth for "is ElevenLabs working".
 *
 * GET  → checks the key + lists whether the configured master voice exists (voices endpoint).
 * POST → full text-to-speech test with a tiny sentence; returns audio if it actually works.
 */

const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Bella (a standard female voice)

function key(st: { elevenLabsKey?: string | null }): { value: string; source: string; hadWhitespace: boolean } | null {
  const envRaw = process.env.ELEVENLABS_API_KEY;
  const dbRaw = st.elevenLabsKey ?? undefined;
  const raw = envRaw ?? dbRaw ?? "";
  if (!raw) return null;
  const trimmed = raw.trim();
  return { value: trimmed, source: envRaw ? "env" : "settings", hadWhitespace: trimmed !== raw };
}

/** Categorize the failure so the UI can show a precise, honest reason. */
function category(status: number, bodySnippet: string): string {
  if (status === 401) return "authentication_failed";
  if (status === 403) return "forbidden_or_key_restricted";
  if (status === 404) return "voice_not_found";
  if (status === 422) return "invalid_request_or_voice";
  if (status === 429) return "quota_or_rate_limit";
  if (/quota/i.test(bodySnippet)) return "quota_unavailable";
  if (status >= 500) return "elevenlabs_server_error";
  return `http_${status}`;
}

export async function GET() {
  const st = await getSettings();
  const k = key(st);
  if (!k) {
    return Response.json({ ok: false, connected: false, category: "no_key", detail: "No ElevenLabs key set (env or Settings)." });
  }
  const voiceId = st.masterElevenVoiceId?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE;
  const started = Date.now();
  try {
    // 1) Does the key authenticate at all? (subscription endpoint is cheap)
    const sub = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": k.value },
      signal: AbortSignal.timeout(12000),
    });
    if (!sub.ok) {
      const body = (await sub.text()).slice(0, 200);
      return Response.json({
        ok: false, connected: false, keySource: k.source, keyHadWhitespace: k.hadWhitespace,
        status: sub.status, category: category(sub.status, body), latencyMs: Date.now() - started,
        detail: safeError(body),
      });
    }
    const subJson = (await sub.json()) as { character_count?: number; character_limit?: number; tier?: string };
    // 2) Does the configured master voice actually exist / is it accessible?
    const v = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { headers: { "xi-api-key": k.value }, signal: AbortSignal.timeout(12000) });
    const voiceOk = v.ok;
    let voiceName: string | undefined;
    if (voiceOk) voiceName = ((await v.json()) as { name?: string }).name;
    return Response.json({
      ok: true, connected: true, keySource: k.source, keyHadWhitespace: k.hadWhitespace,
      tier: subJson.tier, charactersUsed: subJson.character_count, characterLimit: subJson.character_limit,
      voiceId, voiceExists: voiceOk, voiceName, voiceStatus: v.status,
      latencyMs: Date.now() - started,
      detail: voiceOk ? "Key authenticated and master voice found." : `Key authenticated, but voice ${voiceId} is not accessible (status ${v.status}).`,
    });
  } catch (e) {
    return Response.json({ ok: false, connected: false, category: "network_error", detail: (e as Error).message, latencyMs: Date.now() - started });
  }
}

export async function POST(req: Request) {
  const st = await getSettings();
  const k = key(st);
  if (!k) return Response.json({ ok: false, category: "no_key", detail: "No ElevenLabs key set." }, { status: 400 });

  let text = "Hello, I am Rio.";
  try { const b = (await req.json()) as { text?: string }; if (b.text) text = b.text.slice(0, 120); } catch { /* default */ }

  const voiceId = st.masterElevenVoiceId?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE;
  const modelId = process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2";
  const started = Date.now();
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": k.value, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      return Response.json(
        { ok: false, provider: "elevenlabs", voiceId, modelId, status: r.status, category: category(r.status, body), latencyMs: Date.now() - started, detail: safeError(body) },
        { status: 502 },
      );
    }
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) {
      return Response.json({ ok: false, provider: "elevenlabs", voiceId, modelId, status: r.status, category: "empty_audio", detail: "Request succeeded but returned no audio bytes.", latencyMs: Date.now() - started }, { status: 502 });
    }
    // Return the real audio + safe diagnostic headers.
    return new Response(buf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Test-Provider": "elevenlabs",
        "X-Test-Voice": voiceId,
        "X-Test-Model": modelId,
        "X-Test-Latency": String(Date.now() - started),
        "X-Test-Bytes": String(buf.byteLength),
      },
    });
  } catch (e) {
    return Response.json({ ok: false, provider: "elevenlabs", voiceId, modelId, category: "network_error", detail: (e as Error).message, latencyMs: Date.now() - started }, { status: 502 });
  }
}

/** Strip anything that could resemble a key from an error body before returning it. */
function safeError(body: string): string {
  return body.replace(/[A-Za-z0-9_-]{32,}/g, "***").slice(0, 200);
}
