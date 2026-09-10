import { think } from "@/lib/brain";
import type { Tier } from "@/lib/router";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { message?: string; conversationId?: number | null; characterId?: number | null; forceTier?: Tier };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ error: "message required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const ev of think({ message, conversationId: body.conversationId ?? null, characterId: body.characterId ?? null, forceTier: body.forceTier })) {
          send(ev);
        }
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "unknown error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    // X-Accel-Buffering matters for streamed tokens: a proxy that buffers would hold the whole
    // reply and undo the point of streaming.
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
