import { getSettings } from "@/lib/bootstrap";
import { GEMINI_VOICE_NAMES } from "@/lib/voice-emotion";

export const dynamic = "force-dynamic";

/**
 * Lists the voices the user can actually pick, per engine:
 *  - ElevenLabs: live from the account (only voices the saved key can use)
 *  - Gemini: the fixed set of prebuilt voice names
 * The Settings screen uses this to populate the voice dropdowns instead of guessing IDs.
 */
export async function GET() {
  const st = await getSettings();
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() || st.elevenLabsKey?.trim();

  const gemini = GEMINI_VOICE_NAMES.map((name) => ({ id: name, name }));
  let elevenlabs: { id: string; name: string; description?: string; previewUrl?: string }[] = [];
  let elevenError: string | null = null;

  if (elevenKey) {
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": elevenKey },
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          voices?: { voice_id: string; name: string; description?: string; preview_url?: string }[];
        };
        elevenlabs = (j.voices ?? []).map((v) => ({
          id: v.voice_id,
          name: v.name,
          description: v.description ?? undefined,
          previewUrl: v.preview_url ?? undefined,
        }));
      } else {
        elevenError = `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 160)}`;
      }
    } catch (e) {
      elevenError = (e as Error).message;
    }
  }

  return Response.json({
    hasElevenLabs: Boolean(elevenKey),
    hasGemini: Boolean(process.env.GEMINI_API_KEY?.trim() || st.geminiKey?.trim()),
    elevenlabs,
    elevenError,
    gemini,
  });
}
