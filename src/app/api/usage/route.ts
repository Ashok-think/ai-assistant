import { db } from "@/db";
import { usageLogs } from "@/db/schema";
import { getSettings } from "@/lib/bootstrap";
import { buildCatalog, todaySpend } from "@/lib/router";
import { desc, gte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const st = await getSettings();
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const byTier = await db
    .select({ tier: usageLogs.tier, calls: sql<number>`count(*)`, tokensIn: sql<number>`coalesce(sum(${usageLogs.tokensIn}),0)`, tokensOut: sql<number>`coalesce(sum(${usageLogs.tokensOut}),0)`, cost: sql<number>`coalesce(sum(${usageLogs.costUsd}),0)`, avgLatency: sql<number>`coalesce(avg(${usageLogs.latencyMs}),0)` })
    .from(usageLogs)
    .where(gte(usageLogs.createdAt, weekAgo))
    .groupBy(usageLogs.tier)
    .all();
  const byModel = await db
    .select({ provider: usageLogs.provider, model: usageLogs.model, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${usageLogs.costUsd}),0)` })
    .from(usageLogs)
    .where(gte(usageLogs.createdAt, weekAgo))
    .groupBy(usageLogs.provider, usageLogs.model)
    .all();
  const recent = await db.select().from(usageLogs).orderBy(desc(usageLogs.createdAt)).limit(25).all();
  const today = await todaySpend();
  return Response.json({
    today, budget: st.dailyBudgetUsd, freeOnlyMode: st.freeOnlyMode, routerMode: st.routerMode,
    byTier: byTier.map((r) => ({ ...r, calls: Number(r.calls), tokensIn: Number(r.tokensIn), tokensOut: Number(r.tokensOut), cost: Number(r.cost), avgLatency: Number(r.avgLatency) })),
    byModel: byModel.map((r) => ({ ...r, calls: Number(r.calls), cost: Number(r.cost) })),
    recent,
    providers: buildCatalog(st).map((c) => ({ tier: c.tier, provider: c.spec.provider, model: c.spec.model, free: c.spec.free, inPer1M: c.spec.inPer1M, outPer1M: c.spec.outPer1M })),
  });
}
