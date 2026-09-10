import { db } from "@/db";
import { memories } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(memories).orderBy(desc(memories.importance), desc(memories.createdAt)).all();
  return Response.json(rows);
}

export async function POST(req: Request) {
  const b = (await req.json()) as { content: string; kind?: string; importance?: number };
  if (!b.content?.trim()) return Response.json({ error: "content required" }, { status: 400 });
  const [row] = await db.insert(memories).values({ content: b.content.trim(), kind: b.kind ?? "fact", importance: b.importance ?? 3, source: "user" }).returning().all();
  return Response.json(row, { status: 201 });
}

export async function PATCH(req: Request) {
  const b = (await req.json()) as { id: number; content?: string; kind?: string; importance?: number };
  const [row] = await db.update(memories).set({ content: b.content, kind: b.kind, importance: b.importance }).where(eq(memories.id, b.id)).returning().all();
  return Response.json(row);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    await db.delete(memories).where(eq(memories.id, Number(id))).run();
    return Response.json({ ok: true });
  }
  // Wiping every memory is opt-in — on a server with no auth, a bare DELETE shouldn't erase it all.
  if (url.searchParams.get("all") !== "1") {
    return Response.json({ error: "pass ?id= to delete one memory, or ?all=1 to wipe them all" }, { status: 400 });
  }
  await db.delete(memories).run();
  return Response.json({ ok: true });
}
