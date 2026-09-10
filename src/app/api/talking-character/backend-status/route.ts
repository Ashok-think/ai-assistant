import { getTalkingProvider } from "@/server/talking-character";

export const dynamic = "force-dynamic";

/**
 * Honest status of the AI video lip-sync backend. Reflects real config/health only — it never
 * reports "available" unless a backend is actually configured (and, for remote, reachable).
 */
export async function GET() {
  const provider = getTalkingProvider();
  const status = await provider.backendStatus();
  return Response.json(status);
}
