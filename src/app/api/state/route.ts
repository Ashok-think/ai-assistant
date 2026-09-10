import { db } from "@/db";
import { characters, moods, reminders, todos } from "@/db/schema";
import { getActiveCharacter, getSettings } from "@/lib/bootstrap";
import { greetingFor } from "@/lib/characters";
import { buildCatalog } from "@/lib/router";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const st = await getSettings();
  const active = await getActiveCharacter(st);
  const chars = await db.select().from(characters).orderBy(characters.id).all();
  const [lastMood] = await db.select().from(moods).orderBy(desc(moods.createdAt)).limit(1).all();
  const upcoming = await db.select().from(reminders).where(eq(reminders.done, false)).orderBy(reminders.dueAt).limit(5).all();
  const pending = await db.select().from(todos).where(eq(todos.done, false)).orderBy(desc(todos.createdAt)).limit(5).all();
  const catalog = buildCatalog(st).map((c) => ({ tier: c.tier, provider: c.spec.provider, model: c.spec.model, free: c.spec.free }));
  const hasElevenLabs = Boolean(process.env.ELEVENLABS_API_KEY || st.elevenLabsKey);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || st.geminiKey);

  const safe = {
    ...st,
    openaiKey: st.openaiKey ? "••••" : null,
    groqKey: st.groqKey ? "••••" : null,
    openrouterKey: st.openrouterKey ? "••••" : null,
    geminiKey: st.geminiKey ? "••••" : null,
    elevenLabsKey: st.elevenLabsKey ? "••••" : null,
  };

  return Response.json({
    settings: safe,
    character: active,
    characters: chars,
    greeting: greetingFor(active, st.userName, lastMood?.mood),
    lastMood: lastMood ?? null,
    reminders: upcoming,
    todos: pending,
    providers: catalog,
    online: catalog.length > 0,
    hasElevenLabs,
    hasGemini,
  });
}
