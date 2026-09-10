import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { think } from "@/lib/brain";
import { getSettings } from "@/lib/bootstrap";
import { chatCompletion } from "@/lib/llm";
import { route } from "@/lib/router";
import { TOOLS, runTool } from "@/lib/tools";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type PlanStep = { title: string; tool?: string; args?: Record<string, unknown> };

function heuristicPlan(goal: string): PlanStep[] {
  const g = goal.toLowerCase();
  const steps: PlanStep[] = [];
  const place = goal.match(/(?:to|in|at|for)\s+([A-Z][a-zA-Z]+)/)?.[1];
  steps.push({ title: `Research: ${goal.slice(0, 60)}`, tool: "web_search", args: { query: goal } });
  if (place) {
    steps.push({ title: `Check weather in ${place}`, tool: "get_weather", args: { city: place } });
    steps.push({ title: `Look up things to do in ${place}`, tool: "web_search", args: { query: `${place} tourist attractions` } });
  }
  if (/trip|travel|visit|goa|vacation/.test(g)) {
    steps.push({ title: "Add packing task", tool: "add_todo", args: { title: `Pack for ${place ?? "trip"}` } });
    steps.push({ title: "Set booking reminder", tool: "set_reminder", args: { title: `Book tickets for ${place ?? "trip"}`, when: "tomorrow 10am" } });
  }
  if (/exam|study|revise|learn/.test(g)) {
    steps.push({ title: "Create study task", tool: "add_todo", args: { title: `Study plan: ${goal.slice(0, 40)}` } });
    steps.push({ title: "Set study reminder", tool: "set_reminder", args: { title: "Study session", when: "in 2 hours" } });
  }
  // Browser actions
  if (/open|search|play|youtube|google|watch|find.*trailer/.test(g)) {
    if (/youtube/.test(g) || /trailer|video|watch|play/.test(g)) {
      const query = goal.replace(/(?:open|search|play|find|watch)\s+(?:on\s+)?(?:youtube\s+)?(?:for\s+)?/i, "").trim();
      steps.push({ title: `Search YouTube for: ${query}`, tool: "search_youtube", args: { query } });
    } else if (/google/.test(g)) {
      const query = goal.replace(/(?:search|google)\s+(?:for\s+)?/i, "").trim();
      steps.push({ title: `Search Google for: ${query}`, tool: "search_google", args: { query } });
    }
  }
  steps.push({ title: "Save plan as a note", tool: "save_note", args: { title: `Plan: ${goal.slice(0, 40)}`, body: goal } });
  steps.push({ title: "Compose final plan in character" });
  return steps;
}

export async function POST(req: Request) {
  let goal: string | undefined;
  try {
    ({ goal } = (await req.json()) as { goal?: string });
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!goal?.trim()) return Response.json({ error: "goal required" }, { status: 400 });
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const [run] = await db.insert(agentRuns).values({ goal }).returning().all();
      try {
        const st = await getSettings();
        const decision = await route({ settings: st, message: goal, historyChars: 0, systemPromptChars: 800, forceTier: st.routerMode === "auto" ? "smart" : undefined });
        send({ type: "route", tier: decision.tier, model: decision.spec.model, reason: decision.reason });

        // 1) PLAN
        send({ type: "status", text: "Planning…" });
        let plan: PlanStep[] = [];
        if (decision.tier !== "offline") {
          try {
            const toolList = TOOLS.map((t) => `${t.name}(${Object.keys((t.parameters as { properties?: Record<string, unknown> }).properties ?? {}).join(", ")}): ${t.description}`).join("\n");
            const r = await chatCompletion({
              spec: decision.spec, apiKey: decision.apiKey, temperature: 0.2, maxTokens: 700,
              messages: [
                { role: "system", content: `You are a planner. Break the user's goal into 3-7 concrete steps. Each step may call ONE tool from this list:\n${toolList}\nRespond ONLY with JSON: {"steps":[{"title":"...","tool":"tool_name","args":{...}}]}. The last step must be {"title":"Compose final answer"} with no tool.` },
                { role: "user", content: goal },
              ],
            });
            const json = r.content.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
            plan = (JSON.parse(json) as { steps?: PlanStep[] }).steps ?? [];
          } catch {
            plan = [];
          }
        }
        if (!plan.length) plan = heuristicPlan(goal);
        const steps = plan.map((p) => ({ title: p.title, status: "pending" as string, detail: "" as string | undefined }));
        send({ type: "plan", steps });

        // 2) EXECUTE
        const findings: string[] = [];
        for (let i = 0; i < plan.length; i++) {
          const p = plan[i];
          if (!p.tool) continue;
          steps[i].status = "running";
          send({ type: "step", index: i, status: "running" });
          const out = await runTool(p.tool, p.args ?? {});
          findings.push(`${p.title}: ${out.text}`);
          steps[i].status = "done";
          steps[i].detail = out.text;
          send({ type: "step", index: i, status: "done", detail: out.text });
          // Browser-only work (open a tab, draft a message) is forwarded for the client to perform.
          if (out.action) send({ type: "action", id: `agent_${i}`, action: out.action });
          await db.update(agentRuns).set({ steps }).where(eq(agentRuns.id, run.id)).run();
        }

        // 3) SYNTHESIZE (in character, via the brain)
        const last = plan.length - 1;
        steps[last].status = "running";
        send({ type: "step", index: last, status: "running" });
        const prompt = `AGENT MODE. Goal: "${goal}".\nFindings from tools:\n${findings.map((f) => `- ${f}`).join("\n")}\n\nNow write the complete result for the goal (itinerary / plan / answer) in your character voice. Be concrete, structured and friendly. Mention what reminders/todos you created.`;
        let finalText = "";
        for await (const ev of think({ message: prompt, forceTier: decision.tier === "offline" ? undefined : decision.tier })) {
          if (ev.type === "final") finalText = ev.message.content;
          if (ev.type === "tool") findings.push(`${ev.name}: ${ev.result}`);
        }
        if (decision.tier === "offline") {
          finalText = `Here's what I put together for "${goal}":\n\n${findings.map((f) => `• ${f}`).join("\n")}\n\nAdd an API key in Settings and I'll turn this into a full polished plan!`;
        }
        steps[last].status = "done";
        send({ type: "step", index: last, status: "done" });
        await db.update(agentRuns).set({ steps, status: "done", result: finalText }).where(eq(agentRuns.id, run.id)).run();
        send({ type: "final", result: finalText, runId: run.id });
      } catch (e) {
        await db.update(agentRuns).set({ status: "failed" }).where(eq(agentRuns.id, run.id)).run();
        send({ type: "error", error: e instanceof Error ? e.message : "unknown" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
