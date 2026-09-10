import { analyzeImage } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Describe one screenshot. The image is forwarded to a vision model and dropped — never stored
 * or logged. With no vision key we say so plainly instead of inventing a description.
 */
export async function POST(req: Request) {
  let body: { image?: string; question?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const question = (body.question ?? "").trim() || "What is on this screen?";
  const r = await analyzeImage(
    body.image ?? "",
    question,
    "You are looking at a screenshot of the user's screen. Describe what matters for their question in 2-5 short sentences. Read visible text exactly when it's an error, code, or a number. Never guess at anything you can't see. Don't mention that you're an AI or that this is a screenshot.",
  );
  if (r.ok) return Response.json({ description: r.description, model: r.model, provider: r.provider });
  return Response.json({ error: r.error }, { status: r.status });
}
