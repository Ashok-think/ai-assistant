import { client } from "@/db";
import { ensureSeeded } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    await client.execute("SELECT 1");
    return Response.json({ ok: true, engine: "sqlite" });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
