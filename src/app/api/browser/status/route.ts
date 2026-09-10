import { getSettings } from "@/lib/bootstrap";
import { db } from "@/db";
import { skills } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Reports whether the PC browser agent is usable: is the `pc_browser` skill enabled, is the
 * Playwright package present, and is a Chromium context currently running. The UI uses this to
 * show real status instead of guessing.
 */
export async function GET() {
  const [skill] = await db.select().from(skills).where(eq(skills.key, "pc_browser")).all();
  const enabled = skill?.enabled ?? false;

  let playwrightInstalled = false;
  try {
    await import("playwright");
    playwrightInstalled = true;
  } catch {
    playwrightInstalled = false;
  }

  let running = false;
  if (playwrightInstalled) {
    try {
      const { isRunning } = await import("@/server/browser/executor");
      running = await isRunning();
    } catch {
      running = false;
    }
  }

  await getSettings();
  return Response.json({ enabled, playwrightInstalled, running, ready: enabled && playwrightInstalled });
}
