import { analyzeImage } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Analyze an image the user uploaded/dropped into chat ("what is this?", "read this",
 * "explain this photo"). Reuses the shared vision layer; the image is never stored.
 */
export async function POST(req: Request) {
  let body: { image?: string; question?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const question = (body.question ?? "").trim() || "What is in this image?";
  const r = await analyzeImage(body.image ?? "", question);
  if (r.ok) return Response.json({ description: r.description, model: r.model, provider: r.provider });
  return Response.json({ error: r.error }, { status: r.status });
}
