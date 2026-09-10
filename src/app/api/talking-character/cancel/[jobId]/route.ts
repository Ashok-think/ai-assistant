import { getTalkingProvider } from "@/server/talking-character";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const r = await getTalkingProvider().cancelJob(jobId);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
