import { getTalkingProvider } from "@/server/talking-character";
import { getSettings } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Create a talking-video job: (source clip + real TTS audio + emotion + intensity) → backend.
 *
 * Accepts multipart/form-data:
 *   - source_video_url (string)   e.g. /character/neutral.mp4
 *   - audio (file)  OR  text (string, synthesized server-side via the master voice)
 *   - emotion (string), intensity (number)
 *
 * The audio is the EXACT speech to be lip-synced. If no backend is configured, this returns the
 * provider's honest "not configured" error — nothing is faked.
 */
export async function POST(req: Request) {
  const provider = getTalkingProvider();

  // Fail fast (and honestly) if the backend can't generate.
  const status = await provider.backendStatus();
  if (!status.canGenerate) {
    return Response.json({ ok: false, error: status.detail, backend: status }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  const sourceVideoUrl = String(form.get("source_video_url") || "/character/neutral.mp4");
  const emotion = String(form.get("emotion") || "neutral");
  const intensity = Number(form.get("intensity") || 1);
  const audioFile = form.get("audio");
  const text = String(form.get("text") || "").trim();

  let audioBytes: Uint8Array | null = null;
  let audioMime = "audio/mpeg";
  let audioName = "audio.mp3";

  if (audioFile instanceof File) {
    audioBytes = new Uint8Array(await audioFile.arrayBuffer());
    audioMime = audioFile.type || audioMime;
    audioName = audioFile.name || audioName;
  } else if (text) {
    // Synthesize with the master voice via the existing TTS route (server-side, same origin).
    await getSettings();
    const origin = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
    const r = await fetch(`${origin}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, emotion }),
    });
    if (r.status === 200) {
      audioBytes = new Uint8Array(await r.arrayBuffer());
      audioMime = r.headers.get("content-type") || "audio/mpeg";
    } else {
      return Response.json(
        { ok: false, error: "No TTS provider produced audio for the master voice — configure a Gemini/ElevenLabs key. (Lip-sync needs real audio; nothing faked.)" },
        { status: 503 },
      );
    }
  } else {
    return Response.json({ ok: false, error: "provide an 'audio' file or 'text' to synthesize" }, { status: 400 });
  }

  const result = await provider.createTalkingVideo({
    sourceVideoUrl,
    audio: { bytes: audioBytes!, mime: audioMime, filename: audioName },
    emotion,
    intensity,
  });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
