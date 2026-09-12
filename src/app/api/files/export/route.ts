import { exportArtifact } from "@/lib/artifact-export";
import { ensureSeeded } from "@/lib/bootstrap";
import { db } from "@/db";
import { skills } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (process.env.VERCEL === "1") return Response.json({ error: "Local-only export. Cloud artifact storage is not configured." }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing document." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 150000) { await reader.cancel(); return Response.json({ error: "Request too large." }, { status: 413 }); }
      chunks.push(value);
    }
    await ensureSeeded();
    const [skill] = await db.select().from(skills).where(eq(skills.key, "document_export")).limit(1).all();
    if (!skill?.enabled) return Response.json({ error: "Document export is disabled in Skills." }, { status: 403 });
    const artifact = await exportArtifact(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return new Response(Buffer.from(artifact.bytes), { headers: {
      "Content-Type": artifact.mime,
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Length": String(artifact.bytes.byteLength),
      "X-Artifact-SHA256": artifact.sha256,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "Invalid document JSON." : error instanceof Error ? error.message : "Export failed." }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  } finally { reader.releaseLock(); }
}
