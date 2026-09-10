import { db } from "@/db";
import { routines, type RoutineStep } from "@/db/schema";
import { ensureSeeded, getActiveCharacter } from "@/lib/bootstrap";
import { runToolText } from "@/lib/tools";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  return Response.json(await db.select().from(routines).orderBy(routines.id).all());
}

export async function POST(req: Request) {
  const b = (await req.json()) as { name: string; description?: string; steps: RoutineStep[]; schedule?: string; run?: boolean; id?: number };
  // Run an existing routine
  if (b.run && b.id) {
    const [r] = await db.select().from(routines).where(eq(routines.id, b.id)).all();
    if (!r) return Response.json({ error: "not found" }, { status: 404 });
    const c = await getActiveCharacter();
    const results: { tool: string; result: string }[] = [];
    for (const s of r.steps) results.push({ tool: s.tool, result: await runToolText(s.tool, s.args) });
    const phrase = c.catchphrases[0] ?? "";
    const summary = `Here's your ${r.name}, ${c.nickname || "friend"}!\n\n${results.map((x) => `• ${x.result}`).join("\n")}\n\n${phrase}`;
    return Response.json({ ok: true, results, summary });
  }
  if (!b.name) return Response.json({ error: "name required" }, { status: 400 });
  const [row] = await db.insert(routines).values({ name: b.name, description: b.description ?? "", steps: b.steps ?? [], schedule: b.schedule ?? "" }).returning().all();
  return Response.json(row, { status: 201 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) await db.delete(routines).where(eq(routines.id, Number(id))).run();
  return Response.json({ ok: true });
}
