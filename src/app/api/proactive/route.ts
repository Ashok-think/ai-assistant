import { db } from "@/db";
import { memories, moods, reminders, todos } from "@/db/schema";
import { getActiveCharacter, getSettings } from "@/lib/bootstrap";
import { timeOfDay } from "@/lib/characters";
import { and, desc, eq, gte, lte } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Proactive engine: due reminders + contextual nudges.
 * Polled by the client; the mobile app would run this as a background task + push notification.
 */
export async function GET() {
  const st = await getSettings();
  const c = await getActiveCharacter(st);
  const nick = c.nickname || st.userName;
  const now = new Date();
  const items: { id: string; kind: "reminder" | "nudge"; text: string; speak: boolean }[] = [];

  // Due reminders (fire once)
  const due = await db.select().from(reminders).where(and(eq(reminders.done, false), eq(reminders.notified, false), lte(reminders.dueAt, now))).all();
  for (const r of due) {
    items.push({ id: `rem-${r.id}`, kind: "reminder", text: `⏰ ${nick}, it's time: ${r.title}`, speak: true });
    await db.update(reminders).set({ notified: true, done: true }).where(eq(reminders.id, r.id)).run();
  }

  if (!st.proactiveEnabled) return Response.json({ items });

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const tod = timeOfDay(now);

  // Daily mood check-in
  const [moodToday] = await db.select().from(moods).where(gte(moods.createdAt, startOfDay)).limit(1).all();
  if (!moodToday && (tod === "evening" || tod === "afternoon")) {
    items.push({ id: `mood-${startOfDay.toDateString()}`, kind: "nudge", text: `Hey ${nick}, quick check-in — how are you feeling today? Just tell me.`, speak: false });
  }
  // Late night nudge
  if (tod === "night" && now.getHours() >= 23) {
    items.push({ id: `sleep-${startOfDay.toDateString()}`, kind: "nudge", text: `It's past 11, ${nick}. You usually wind down around now — want me to set tomorrow's alarm?`, speak: false });
  }
  // Upcoming events from memory (exam, birthday...)
  const evs = await db.select().from(memories).where(eq(memories.kind, "event")).orderBy(desc(memories.importance)).limit(5).all();
  const tomorrow = new Date(now.getTime() + 86400000);
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const e of evs) {
    const l = e.content.toLowerCase();
    const day = tomorrow.getDate();
    const mn = monthNames[tomorrow.getMonth()];
    if ((l.includes(`${day} ${mn}`) || l.includes(`${mn} ${day}`) || l.includes("tomorrow")) && /exam|test|birthday|interview|deadline/.test(l)) {
      items.push({ id: `event-${e.id}-${startOfDay.toDateString()}`, kind: "nudge", text: `Heads up ${nick}: "${e.content}" — want to prep or revise together?`, speak: false });
    }
  }
  // Stale todos
  const pending = await db.select().from(todos).where(eq(todos.done, false)).limit(10).all();
  if (pending.length >= 5 && tod === "morning") {
    items.push({ id: `todos-${startOfDay.toDateString()}`, kind: "nudge", text: `${pending.length} tasks are waiting, ${nick}. Pick one small one and let's knock it out first.`, speak: false });
  }

  return Response.json({ items });
}
