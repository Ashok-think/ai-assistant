import { db } from "@/db";
import { skills } from "@/db/schema";
import { ensureSeeded } from "@/lib/bootstrap";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(skills).orderBy(skills.id).all();
  return Response.json(rows);
}

export async function PATCH(req: Request) {
  const b = (await req.json()) as { id: number; enabled: boolean };
  const [row] = await db.update(skills).set({ enabled: b.enabled }).where(eq(skills.id, b.id)).returning().all();
  return Response.json(row);
}

export async function POST(req: Request) {
  const b = (await req.json()) as { key: string; name: string; description?: string; category?: string };
  if (!b.key || !b.name) return Response.json({ error: "key and name required" }, { status: 400 });
  const [row] = await db.insert(skills).values({ key: b.key.toLowerCase().replace(/[^a-z0-9_]/g, "_"), name: b.name, description: b.description ?? "", category: b.category ?? "custom", enabled: true, builtin: false }).returning().all();
  return Response.json(row, { status: 201 });
}
