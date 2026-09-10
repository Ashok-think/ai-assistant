import { db } from "@/db";
import { skills } from "@/db/schema";
import { getSettings } from "@/lib/bootstrap";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Real status of the Android device agent: is the skill enabled, and can we actually reach the
 * native bridge / is its accessibility service on. Probes the device — nothing is assumed.
 */
export async function GET() {
  await getSettings();
  const [skill] = await db.select().from(skills).where(eq(skills.key, "android")).all();
  const enabled = skill?.enabled ?? false;

  let bridge = false;
  let accessibilityEnabled = false;
  let target = "";
  let detail = "skill disabled — enable the Android Device Agent in Skills";
  if (enabled) {
    try {
      const { androidStatus } = await import("@/server/android/executor");
      const s = await androidStatus();
      bridge = s.bridge;
      accessibilityEnabled = s.accessibilityEnabled;
      target = s.target;
      detail = s.detail;
    } catch (e) {
      detail = (e as Error).message;
    }
  }

  return Response.json({
    enabled,
    bridge,
    accessibilityEnabled,
    connected: bridge && accessibilityEnabled,
    target,
    detail,
  });
}
