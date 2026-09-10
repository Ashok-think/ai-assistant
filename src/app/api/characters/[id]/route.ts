import { db } from "@/db";
import { characters, settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json()) as Partial<typeof characters.$inferInsert>;
  const patch: Partial<typeof characters.$inferInsert> = {};
  for (const k of ["name", "tagline", "emoji", "color", "accent", "personalityPrompt", "speakingStyle", "catchphrases", "nickname", "sliders", "voice", "defaultMood"] as const) {
    if (k in b) (patch as Record<string, unknown>)[k] = b[k];
  }
  const [row] = await db.update(characters).set(patch).where(eq(characters.id, Number(id))).returning();
  return Response.json(row);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const cid = Number(id);
  const [c] = await db.select().from(characters).where(eq(characters.id, cid));
  if (!c) return Response.json({ error: "not found" }, { status: 404 });
  if (!c.isCustom) return Response.json({ error: "Built-in characters can't be deleted" }, { status: 400 });
  await db.delete(characters).where(eq(characters.id, cid));
  const [first] = await db.select().from(characters).limit(1);
  await db.update(settings).set({ activeCharacterId: first?.id ?? null }).where(eq(settings.activeCharacterId, cid));
  return Response.json({ ok: true });
}
