import { db } from "@/db";
import { skills } from "@/db/schema";
import { ensureSeeded } from "@/lib/bootstrap";
import { eq } from "drizzle-orm";
import { SKILL_PACKAGES } from "@/lib/skill-packages";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(skills).orderBy(skills.id).all();
  return Response.json(rows.map((row) => {
    const reviewed = SKILL_PACKAGES.find((entry) => entry.key === row.key);
    return { ...row, readiness: reviewed?.status, source: reviewed?.source };
  }));
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const b = await req.json().catch(() => null);
  if (!b || !Number.isSafeInteger(b.id) || b.id < 1 || typeof b.enabled !== "boolean") return Response.json({ error: "Valid id and enabled boolean required." }, { status: 400 });
  const [existing] = await db.select().from(skills).where(eq(skills.id, b.id)).limit(1).all();
  if (!existing) return Response.json({ error: "Skill not found." }, { status: 404 });
  if (b.enabled && SKILL_PACKAGES.some((entry) => entry.key === existing.key && entry.status === "blocked")) return Response.json({ error: "This package runtime is unavailable. Toggling a manifest cannot install or execute it." }, { status: 409 });
  const [row] = await db.update(skills).set({ enabled: b.enabled }).where(eq(skills.id, b.id)).returning().all();
  return Response.json(row);
}

export async function POST(req: Request) {
  const b = (await req.json()) as { key: string; name: string; description?: string; category?: string };
  if (!b.key || !b.name) return Response.json({ error: "key and name required" }, { status: 400 });
  const [row] = await db.insert(skills).values({ key: b.key.toLowerCase().replace(/[^a-z0-9_]/g, "_"), name: b.name, description: b.description ?? "", category: b.category ?? "custom", enabled: true, builtin: false }).returning().all();
  return Response.json(row, { status: 201 });
}
