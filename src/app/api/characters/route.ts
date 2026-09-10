import { db } from "@/db";
import { characters } from "@/db/schema";
import { ensureSeeded } from "@/lib/bootstrap";
import { pickVoiceForSliders } from "@/lib/voice-emotion";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(characters).orderBy(characters.id).all();
  return Response.json(rows);
}

export async function POST(req: Request) {
  await ensureSeeded();
  let b: Partial<typeof characters.$inferInsert> & { name?: string };
  try {
    b = (await req.json()) as Partial<typeof characters.$inferInsert> & { name?: string };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!b.name?.trim()) return Response.json({ error: "name required" }, { status: 400 });
  const slug = `${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  const sliders = b.sliders ?? { funny: 50, soft: 50, calm: 50 };
  const pick = pickVoiceForSliders(sliders);
  const [row] = await db
    .insert(characters)
    .values({
      slug,
      name: b.name.trim(),
      tagline: b.tagline ?? "Custom character",
      emoji: b.emoji ?? "✨",
      color: b.color ?? "#a855f7",
      accent: b.accent ?? "#f0abfc",
      personalityPrompt: b.personalityPrompt ?? `You are ${b.name}, a warm best-friend companion.`,
      speakingStyle: b.speakingStyle ?? "Casual, warm, natural.",
      catchphrases: b.catchphrases ?? [],
      nickname: b.nickname ?? "",
      sliders,
      // A custom character still gets its own Gemini / ElevenLabs voice, chosen from its sliders.
      voice: {
        pitch: 1,
        rate: 1,
        warmth: 50,
        ...b.voice,
        geminiVoice: b.voice?.geminiVoice ?? pick.gemini,
        elevenLabsVoiceId: b.voice?.elevenLabsVoiceId ?? pick.elevenLabs,
      },
      defaultMood: b.defaultMood ?? "happy",
      isCustom: true,
    })
    .returning()
    .all();
  return Response.json(row, { status: 201 });
}
