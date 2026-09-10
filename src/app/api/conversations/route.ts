import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const rows = await db.select().from(messages).where(eq(messages.conversationId, Number(id))).orderBy(messages.createdAt).all();
    return Response.json(rows);
  }
  const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt)).limit(30).all();
  return Response.json(rows);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    await db.delete(messages).where(eq(messages.conversationId, Number(id))).run();
    await db.delete(conversations).where(eq(conversations.id, Number(id))).run();
    return Response.json({ ok: true });
  }
  // Wiping all history is opt-in — on a server with no auth, a bare DELETE shouldn't erase it all.
  if (url.searchParams.get("all") !== "1") {
    return Response.json({ error: "pass ?id= to delete one conversation, or ?all=1 to wipe them all" }, { status: 400 });
  }
  await db.delete(messages).run();
  await db.delete(conversations).run();
  return Response.json({ ok: true });
}
