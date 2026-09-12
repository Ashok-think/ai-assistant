import { db } from "@/db";
import { characters, conversations, memories, messages, moods, skills, type ToolCallLog } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { buildSystemPrompt, parseEmotion, type Emotion } from "./characters";
import { getSettings } from "./bootstrap";
import { chatCompletionStream, LLMError, llmErrorMessage, type ChatMessage, type LLMResult } from "./llm";
import { offlineRespond } from "./offline";
import { logUsage, routeChain, type RouteDecision, type Tier } from "./router";
import { TOOLS, runTool, toolsForLLM } from "./tools";
import { actionDirective, classify } from "./intent";
import type { ClientAction } from "./actions";

export type BrainEvent =
  | { type: "route"; decision: { tier: Tier; provider: string; model: string; reason: string; complexity: number; estimatedInputTokens: number; budgetUsedUsd: number; budgetUsd: number } }
  | { type: "status"; text: string }
  | { type: "intent"; intent: string; isAction: boolean }
  /** A slice of the reply, as the model produces it. The client appends these live. */
  | { type: "delta"; text: string }
  /** The provider died mid-reply; drop whatever it streamed, a fallback is taking over. */
  | { type: "restart"; reason: string }
  /** A provider hit a quota/rate limit — the UI shows a precise "limit reached" message. */
  | { type: "quota"; provider: string; kind: string; message: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; result: string }
  /** Work only the browser can do. The client performs it and POSTs the outcome back. */
  | { type: "action"; id: string; action: ClientAction }
  | { type: "action_step"; step: string; status: "planning" | "searching" | "executing" | "verifying" | "completed" | "failed" }
  | { type: "final"; message: { id: number; content: string; emotion: Emotion; model: string; tier: Tier; tokensIn: number; tokensOut: number; costUsd: number; toolCalls: ToolCallLog[]; characterId: number | null }; conversationId: number }
  | { type: "error"; error: string };

let actionSeq = 0;
const nextActionId = () => `act_${Date.now().toString(36)}_${(actionSeq++).toString(36)}`;

/**
 * Every reply opens with an emotion tag (`[happy] Hi there`), and streaming it raw means the user
 * watches `[`, `hap`, `py]` appear before the actual words. So hold the opening characters back
 * until the tag is either consumed or ruled out, then pass everything through untouched.
 */
function makeEmotionFilter() {
  let head = "";
  let open = false;
  const release = () => {
    const out = head;
    head = "";
    open = true;
    return out;
  };
  return (chunk: string): string => {
    if (open) return chunk;
    head += chunk;
    const t = head.trimStart();
    if (!t) return ""; // whitespace only so far — nothing to decide on yet
    if (!t.startsWith("[")) return release();
    const close = t.indexOf("]");
    // 12 chars is longer than the longest tag, so an unclosed bracket by then isn't one.
    if (close === -1) return head.length > 12 ? release() : "";
    if (!/^\[(happy|excited|sad|angry|shy|sleepy|neutral|thinking)\]$/i.test(t.slice(0, close + 1))) return release();
    head = t.slice(close + 1).replace(/^\s+/, "");
    return release();
  };
}

export async function* think(opts: {
  message: string;
  conversationId?: number | null;
  characterId?: number | null;
  forceTier?: Tier;
  selectedProvider?: string | null;
  selectedModel?: string | null;
}): AsyncGenerator<BrainEvent> {
  const st = await getSettings();
  const charId = opts.characterId ?? st.activeCharacterId;
  const [character] = charId ? await db.select().from(characters).where(eq(characters.id, charId)).all() : await db.select().from(characters).limit(1).all();

  // conversation
  let convId = opts.conversationId ?? null;
  if (!convId) {
    const [c] = await db.insert(conversations).values({ title: opts.message.slice(0, 48), characterId: character.id }).returning().all();
    convId = c.id;
  }
  await db.insert(messages).values({ conversationId: convId, role: "user", content: opts.message }).run();

  // context
  const history = await db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(desc(messages.createdAt)).limit(16).all();
  history.reverse();
  const mems = await db.select().from(memories).orderBy(desc(memories.importance), desc(memories.createdAt)).limit(25).all();
  const [lastMood] = await db.select().from(moods).orderBy(desc(moods.createdAt)).limit(1).all();
  const skillRows = await db.select().from(skills).where(eq(skills.enabled, true)).all();
  const enabledSkills = new Set(skillRows.map((s) => s.key));
  const availableTools = TOOLS.filter((t) => enabledSkills.has(t.skillKey)).map((t) => t.name);

  // PLAN: cheap rule pass so the UI can show what we think this is before the model replies,
  // and so action requests carry a hard "you must call a tool" directive.
  const intent = classify(opts.message);
  yield { type: "intent", intent: intent.label, isAction: intent.isAction };
  if (intent.isAction) yield { type: "action_step", step: intent.label, status: "planning" };
  const directive = actionDirective(intent, availableTools);

  const systemPrompt = buildSystemPrompt({
    character,
    assistantName: st.assistantName,
    userName: st.userName,
    language: st.language,
    memories: mems.map((m) => m.content),
    safeMode: st.safeMode,
    toolNames: availableTools,
    recentMood: lastMood?.mood ?? null,
  }) + (directive ? `\n\n${directive}` : "");

  const historyChars = history.reduce((n, m) => n + m.content.length, 0);
  const chain = await routeChain({ settings: st, message: opts.message, historyChars, systemPromptChars: systemPrompt.length, forceTier: opts.forceTier, selectedProvider: opts.selectedProvider, selectedModel: opts.selectedModel });
  let decision: RouteDecision = chain[0];
  const announce = (d: RouteDecision): BrainEvent => ({
    type: "route",
    decision: {
      tier: d.tier, provider: d.spec.provider, model: d.spec.model, reason: d.reason,
      complexity: d.complexity, estimatedInputTokens: d.estimatedInputTokens, budgetUsedUsd: d.budgetUsedUsd, budgetUsd: d.budgetUsd,
    },
  });
  yield announce(decision);

  const started = Date.now();
  let finalText = "";
  let tokensIn = 0;
  let tokensOut = 0;
  const toolLog: ToolCallLog[] = [];
  let browserBlocked = false;

  const msgs: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(0, -1).map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.role === "assistant" && m.emotion ? `[${m.emotion}] ${m.content}` : m.content })),
    { role: "user", content: opts.message },
  ];
  const tools = toolsForLLM(enabledSkills);

  // Walk the provider chain. Each entry gets one shot; a failure moves to the next rather than
  // dropping straight to the offline engine, which is always the last link.
  for (let attempt = 0; attempt < chain.length; attempt++) {
    decision = chain[attempt];
    if (attempt > 0) yield announce(decision);

    if (decision.tier === "offline") {
      yield { type: "status", text: "Thinking offline…" };
      const r = await offlineRespond(character, opts.message, st.userName);
      for (const tc of r.toolCalls) {
        toolLog.push(tc);
        yield { type: "tool", name: tc.name, args: tc.args, result: tc.result };
      }
      if (r.action) {
        yield { type: "action", id: nextActionId(), action: r.action };
        yield { type: "action_step", step: r.action.label, status: "executing" };
      }
      finalText = r.text;
      tokensIn = decision.estimatedInputTokens;
      tokensOut = Math.ceil(finalText.length / 4);
      break;
    }

    const parts: string[] = [];
    try {
      for (let step = 0; step < 6; step++) {
        yield { type: "status", text: step === 0 ? `Thinking with ${decision.spec.model}…` : "Working through tools…" };
        // A fresh filter per step: a model that talks before a tool call, then talks again after,
        // sometimes re-emits the emotion tag on the second pass.
        const strip = makeEmotionFilter();
        let r: LLMResult | null = null;
        for await (const ev of chatCompletionStream({
          spec: decision.spec,
          apiKey: decision.apiKey,
          messages: msgs,
          tools,
          // Only the first attempt is impatient; by the time we're on a fallback, waiting beats
          // running out of providers.
          firstTokenTimeoutMs: attempt === 0 ? 12000 : 25000,
        })) {
          if (ev.type === "delta") {
            const visible = strip(ev.text);
            if (visible) yield { type: "delta", text: visible };
          } else {
            r = ev.result;
          }
        }
        if (!r) throw new Error(`${decision.spec.provider} closed the stream without finishing`);
        tokensIn += r.tokensIn;
        tokensOut += r.tokensOut;
        if (r.content.trim()) parts.push(r.content.trim());
        if (r.toolCalls.length) {
          msgs.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls });
          for (const tc of r.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments || "{}");
            } catch {
              args = {};
            }
            yield { type: "action_step", step: `Executing tool: ${tc.function.name}`, status: "executing" };
            const run = await runTool(tc.function.name, args);
            toolLog.push({ name: tc.function.name, args, result: run.text });
            yield { type: "tool", name: tc.function.name, args, result: run.text };
            // A missing companion/browser session is not recoverable by repeating the same
            // server-side tool. Stop the tool loop so the assistant reports one truthful result.
            if (tc.function.name.startsWith("pc_") && /blocked|pairing|authentication|not available|not configured|cannot control/i.test(run.text)) {
              browserBlocked = true;
              if (tc.function.name === "pc_youtube_search" || tc.function.name === "search_youtube") {
                const query = typeof args.query === "string" ? args.query : "latest song";
                const action: ClientAction = { kind: "youtube_search", query, label: `Search YouTube for ${query}` };
                yield { type: "action", id: nextActionId(), action };
                yield { type: "action_step", step: action.label, status: "executing" };
                finalText = `I opened YouTube search for “${query}”. Choose the matching result and press play.`;
              } else {
                finalText = `I can’t control your computer from this cloud session. ${run.text.replace(/^(Could not|YouTube search failed|Google search failed)[^:]*:\s*/i, "")}`;
              }
              break;
            }
            if (run.action) {
              yield { type: "action", id: nextActionId(), action: run.action };
              yield { type: "action_step", step: run.action.label, status: "verifying" };
            }
            msgs.push({ role: "tool", tool_call_id: tc.id, content: run.text });
          }
          if (browserBlocked) break;
          continue;
        }
        break;
      }
      if (!browserBlocked) finalText = parts.join("\n\n");
      if (!finalText) finalText = "[thinking] I got a little tangled up there. Can you say that again?";
      break;
    } catch (e) {
      const next = chain[attempt + 1];
      // Anything already on screen came from a provider that just died, so tell the client to
      // clear the bubble before the next one starts writing into it.
      if (parts.length || tokensOut) yield { type: "restart", reason: e instanceof Error ? e.message : "unknown" };
      tokensIn = 0;
      tokensOut = 0;

      if (e instanceof LLMError) {
        // Surface a precise quota/limit message + a machine-readable quota event for the UI.
        yield { type: "quota", provider: e.provider, kind: e.kind, message: llmErrorMessage(e) };
        // A per-minute rate limit gets ONE short backoff before we fall to the next provider.
        if (e.kind === "rate_limited") {
          yield { type: "status", text: `${e.provider} rate limited — waiting a moment…` };
          await new Promise((r) => setTimeout(r, 1500));
        }
        yield {
          type: "status",
          text: next && next.tier !== "offline" ? `${llmErrorMessage(e)} Trying ${next.spec.provider}…` : llmErrorMessage(e),
        };
      } else {
        const why = e instanceof Error ? e.message : "unknown";
        yield {
          type: "status",
          text: next && next.tier !== "offline" ? `${decision.spec.provider} failed (${why}) — trying ${next.spec.provider}…` : `Provider error, falling back offline: ${why}`,
        };
      }
    }
  }

  if (intent.isAction) {
    // VERIFY: an action intent that produced no tool call is the exact failure mode the
    // directive exists to prevent, so say so instead of letting the model's claim stand.
    const acted = toolLog.length > 0;
    // A tool "ran" but the executor may have returned an error string. Detect real failure so
    // the assistant can't announce success on top of a failed browser action.
    const failWords = /\b(couldn't|could not|failed|error|not on the allowlist|did not load|unable)\b/i;
    const browserRuns = toolLog.filter((t) => t.name.startsWith("pc_"));
    const browserFailed = browserRuns.length > 0 && browserRuns.every((t) => failWords.test(t.result));
    const claimsSuccess = /\b(done|opened|playing|found it|here you go|all set|success)\b/i.test(finalText);

    yield { type: "action_step", step: intent.label, status: acted && !browserFailed ? "completed" : "failed" };

    if (!acted && /\b(open(ing)?|sen(d|t|ding)|launch(ing)?|search(ing)?)\b/i.test(finalText)) {
      finalText += `\n\n_(Heads up: I couldn't actually do that one — ${intent.tools[0] ?? "the tool"} isn't enabled. Turn it on in Skills.)_`;
    } else if (browserFailed && claimsSuccess) {
      // The model claimed success but every browser tool errored — correct the record honestly.
      const why = browserRuns[browserRuns.length - 1]?.result ?? "the browser action failed";
      finalText += `\n\n_(Actually, that didn't go through: ${why.replace(/^Could not[^:]*:\s*/i, "")})_`;
    }
  }

  const latencyMs = Date.now() - started;
  const costUsd = await logUsage({ decision, tokensIn, tokensOut, latencyMs });
  const { emotion, clean } = parseEmotion(finalText);

  const [saved] = await db
    .insert(messages)
    .values({
      conversationId: convId, role: "assistant", content: clean, characterId: character.id, emotion,
      model: decision.spec.model, tier: decision.tier, tokensIn, tokensOut, costUsd, toolCalls: toolLog,
    })
    .returning()
    .all();

  yield {
    type: "final",
    conversationId: convId,
    message: { id: saved.id, content: clean, emotion, model: decision.spec.model, tier: decision.tier, tokensIn, tokensOut, costUsd, toolCalls: toolLog, characterId: character.id },
  };
}
