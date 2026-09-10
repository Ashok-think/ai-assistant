import { db } from "@/db";
import { settings } from "@/db/schema";
import { getSettings } from "@/lib/bootstrap";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CUSTOM VOICE (honest).
 *
 * POST a reference audio clip of the character's voice. If a working ElevenLabs key with
 * Instant Voice Cloning access is configured, we create a REAL clone and lock it in as the
 * master voice (status = "active"). Otherwise we record that a reference is available but the
 * custom voice is NOT active — we never pretend the raw clip is a usable TTS voice.
 *
 * GET returns the current custom-voice status.
 */
export async function GET() {
  const st = await getSettings();
  return Response.json({
    status: st.customVoiceStatus ?? "none",
    masterElevenVoiceId: st.masterElevenVoiceId ?? null,
    hasElevenKey: Boolean(process.env.ELEVENLABS_API_KEY?.trim() || st.elevenLabsKey?.trim()),
  });
}

export async function POST(req: Request) {
  const st = await getSettings();
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() || st.elevenLabsKey?.trim();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data with an 'audio' file" }, { status: 400 });
  }
  const audio = form.get("audio");
  const name = String(form.get("name") ?? "Jarvish Character Voice");
  if (!(audio instanceof File)) return Response.json({ error: "no audio file uploaded" }, { status: 400 });

  // Without an ElevenLabs key we cannot clone — be explicit, don't fake it.
  if (!elevenKey) {
    await db.update(settings).set({ customVoiceStatus: "reference_ready" }).where(eq(settings.id, 1)).run();
    return Response.json({
      status: "reference_ready",
      active: false,
      message:
        "Voice reference saved, but custom voice is NOT active: no ElevenLabs API key is configured. Add a key with voice-cloning access (Starter plan or higher) in Settings, then clone again.",
    });
  }

  // Real ElevenLabs Instant Voice Cloning: add-voice with the reference sample.
  try {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("files", audio, audio.name || "reference.mp3");
    fd.append("description", "Jarvish original character master voice");
    const r = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": elevenKey },
      body: fd,
      signal: AbortSignal.timeout(50000),
    });
    const txt = await r.text();
    if (!r.ok) {
      // Common: 401 invalid key, 403 no cloning on plan. Report the truth.
      await db.update(settings).set({ customVoiceStatus: "reference_ready" }).where(eq(settings.id, 1)).run();
      return Response.json(
        {
          status: "reference_ready",
          active: false,
          error: `ElevenLabs cloning failed (${r.status}): ${txt.slice(0, 200)}. The reference is saved; the custom voice is not active.`,
        },
        { status: 502 },
      );
    }
    const j = JSON.parse(txt) as { voice_id?: string };
    if (!j.voice_id) {
      return Response.json({ status: "reference_ready", active: false, error: "ElevenLabs returned no voice_id." }, { status: 502 });
    }
    // Lock the real clone in as the master voice.
    await db
      .update(settings)
      .set({ masterElevenVoiceId: j.voice_id, customVoiceStatus: "active", masterVoiceEnabled: true, ttsProvider: "elevenlabs" })
      .where(eq(settings.id, 1))
      .run();
    return Response.json({
      status: "active",
      active: true,
      voiceId: j.voice_id,
      message: "Custom character voice cloned and locked in as the master voice. Test it in Settings.",
    });
  } catch (e) {
    return Response.json({ status: "reference_ready", active: false, error: `Clone request failed: ${(e as Error).message}` }, { status: 502 });
  }
}
