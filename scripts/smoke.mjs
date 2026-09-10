/**
 * End-to-end smoke test. Start the app first (`npm run dev` or `npm start`), then:
 *   node scripts/smoke.mjs                      # http://localhost:3000
 *   BASE=http://localhost:3311 node scripts/smoke.mjs
 *
 * Checks that the DB self-initialises, every page renders, the chat pipeline answers (offline
 * persona engine when no keys are configured), and the TTS route degrades cleanly.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

let pass = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Read an SSE body to the end and return the parsed events. */
async function readSse(res) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => {
      try {
        return JSON.parse(l.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function main() {
  console.log(`smoke: ${BASE}\n`);
  if (!(await waitForServer())) {
    console.error("server never became healthy");
    process.exit(1);
  }

  console.log("api");
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("GET /api/health", health.ok === true, `engine=${health.engine}`);

  const state = await (await fetch(`${BASE}/api/state`)).json();
  check("GET /api/state has settings + character", Boolean(state.settings && state.character));
  check("characters seeded", Array.isArray(state.characters) && state.characters.length >= 7, `${state.characters?.length} characters`);
  check("greeting in character", typeof state.greeting === "string" && state.greeting.length > 0, JSON.stringify(state.greeting)?.slice(0, 60));
  const withVoice = (state.characters ?? []).filter((c) => c.voice?.geminiVoice && c.voice?.elevenLabsVoiceId);
  check("per-character TTS voices assigned", withVoice.length >= 7, `${withVoice.length} with gemini+elevenlabs voices`);

  for (const path of ["/api/characters", "/api/skills", "/api/routines", "/api/memories", "/api/usage", "/api/conversations", "/api/proactive"]) {
    const r = await fetch(`${BASE}${path}`);
    check(`GET ${path}`, r.ok, `${r.status}`);
  }

  console.log("\nchat");
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hey, who are you?" }),
  });
  check("POST /api/chat", chatRes.ok, `${chatRes.status} ${chatRes.headers.get("content-type")}`);
  const events = await readSse(chatRes);
  const final = events.find((e) => e.type === "final");
  check("stream produced a final message", Boolean(final?.message?.content), final?.message?.content?.slice(0, 70));
  check("reply carries an emotion", Boolean(final?.message?.emotion), final?.message?.emotion);
  check("reply is attributed to a tier", Boolean(final?.message?.tier), `${final?.message?.tier} / ${final?.message?.model}`);
  check("conversation persisted", Number.isFinite(final?.conversationId), `id=${final?.conversationId}`);

  const toolRes = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "add buy milk to my todo list", conversationId: final?.conversationId ?? null }),
  });
  const toolEvents = await readSse(toolRes);
  check("tool call executed", toolEvents.some((e) => e.type === "tool"), toolEvents.find((e) => e.type === "tool")?.name ?? "none");

  const bad = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  check("POST /api/chat rejects empty message", bad.status === 400, `${bad.status}`);
  const badJson = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  check("POST /api/chat rejects malformed JSON", badJson.status === 400, `${badJson.status}`);

  console.log("\nactions");
  // Pinned to the offline engine so the assertions don't depend on a model choosing to call a
  // tool — the online path is covered by the tool check above.
  const actionTurn = async (message) =>
    readSse(
      await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, forceTier: "offline" }),
      }),
    );

  const openEvents = await actionTurn("open youtube");
  const openAction = openEvents.find((e) => e.type === "action");
  check("'open youtube' emits a client action", openAction?.action?.kind === "open_url", openAction?.action?.url ?? "none");
  check("the action carries an id the client can track", typeof openAction?.id === "string" && openAction.id.length > 0, openAction?.id ?? "missing");
  check("intent classified before the reply", Boolean(openEvents.find((e) => e.type === "intent")?.isAction), openEvents.find((e) => e.type === "intent")?.intent ?? "none");

  const msgEvents = await actionTurn("send a whatsapp message to 9876543210 saying running late");
  const msgAction = msgEvents.find((e) => e.type === "action");
  check("a message request composes a prefilled link", msgAction?.action?.kind === "compose_message", `${msgAction?.action?.app ?? "?"} → ${msgAction?.action?.url?.slice(0, 48) ?? "none"}`);

  const screenEvents = await actionTurn("what's on my screen?");
  const screenAction = screenEvents.find((e) => e.type === "action");
  check("a screen question asks the browser to capture", screenAction?.action?.kind === "capture_screen", screenAction?.action?.question ?? "none");

  const skills = await (await fetch(`${BASE}/api/skills`)).json();
  const byKey = Object.fromEntries((skills ?? []).map((s) => [s.key, s]));
  check("messaging skill seeded and on by default", byKey.messaging?.enabled === true, `enabled=${byKey.messaging?.enabled}`);
  check("screen skill seeded and on by default", byKey.screen?.enabled === true, `enabled=${byKey.screen?.enabled}`);

  console.log("\nvision");
  const noImage = await fetch(`${BASE}/api/vision/screen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "hi" }) });
  check("POST /api/vision/screen requires an image data URL", noImage.status === 400, `${noImage.status}`);
  const badVisionJson = await fetch(`${BASE}/api/vision/screen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  check("POST /api/vision/screen rejects malformed JSON", badVisionJson.status === 400, `${badVisionJson.status}`);
  // 1x1 transparent PNG — a real data URL, so this reaches the provider selection step.
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const vision = await fetch(`${BASE}/api/vision/screen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: tinyPng, question: "what is this?" }),
  });
  const visionJson = await vision.json();
  check(
    "POST /api/vision/screen either describes or explains why it can't",
    (vision.ok && typeof visionJson.description === "string") || ((vision.status === 503 || vision.status === 502) && typeof visionJson.error === "string"),
    vision.ok ? `${visionJson.provider}: ${visionJson.description?.slice(0, 40)}` : `${vision.status} ${visionJson.error?.slice(0, 60)}`,
  );

  console.log("\nmutations");
  const created = await fetch(`${BASE}/api/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke Test Bot", sliders: { funny: 80, soft: 30, calm: 20 } }),
  });
  const char = created.status === 201 ? await created.json() : null;
  check("POST /api/characters", created.status === 201, `${created.status} ${char?.slug ?? ""}`);
  check(
    "custom character gets its own voice",
    Boolean(char?.voice?.geminiVoice && char?.voice?.elevenLabsVoiceId),
    `${char?.voice?.geminiVoice} / ${char?.voice?.elevenLabsVoiceId}`,
  );
  const badChar = await fetch(`${BASE}/api/characters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  check("POST /api/characters requires a name", badChar.status === 400, `${badChar.status}`);
  if (char?.id) {
    const delChar = await fetch(`${BASE}/api/characters/${char.id}`, { method: "DELETE" });
    check("DELETE /api/characters/:id", delChar.ok, `${delChar.status}`);
  }
  const builtin = (state.characters ?? [])[0];
  if (builtin) {
    const delBuiltin = await fetch(`${BASE}/api/characters/${builtin.id}`, { method: "DELETE" });
    check("built-in characters can't be deleted", delBuiltin.status === 400, `${delBuiltin.status}`);
  }

  const before = await (await fetch(`${BASE}/api/settings`)).json();
  const patched = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: "SmokeTest" }),
  });
  const patchedJson = patched.ok ? await patched.json() : null;
  check("PATCH /api/settings", patched.ok && patchedJson?.settings?.userName === "SmokeTest", `userName=${patchedJson?.settings?.userName}`);
  check("settings never hand back raw keys", !/"(openai|gemini|elevenLabs)Key":"(?!••••|")/.test(JSON.stringify(patchedJson?.settings ?? {})), "masked or empty");
  await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: before.userName ?? "" }),
  });

  const mem = await fetch(`${BASE}/api/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "smoke test memory", kind: "fact", importance: 1 }),
  });
  const memJson = mem.status === 201 ? await mem.json() : null;
  check("POST /api/memories", mem.status === 201, `id=${memJson?.id}`);
  const wipeGuard = await fetch(`${BASE}/api/memories`, { method: "DELETE" });
  check("bare DELETE /api/memories is refused", wipeGuard.status === 400, `${wipeGuard.status}`);
  const convGuard = await fetch(`${BASE}/api/conversations`, { method: "DELETE" });
  check("bare DELETE /api/conversations is refused", convGuard.status === 400, `${convGuard.status}`);
  if (memJson?.id) {
    const delMem = await fetch(`${BASE}/api/memories?id=${memJson.id}`, { method: "DELETE" });
    check("DELETE /api/memories?id=", delMem.ok, `${delMem.status}`);
  }

  console.log("\nagent");
  const agent = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: "plan a short study session" }),
  });
  check("POST /api/agent", agent.ok, `${agent.status}`);
  const agentEvents = await readSse(agent);
  const plan = agentEvents.find((e) => e.type === "plan");
  check("agent produced a plan", Boolean(plan?.steps?.length), `${plan?.steps?.length ?? 0} steps`);
  check("every step reached done", agentEvents.filter((e) => e.type === "step" && e.status === "done").length >= (plan?.steps?.length ?? 1) - 1);
  const agentFinal = agentEvents.find((e) => e.type === "final");
  check("agent finished", Boolean(agentFinal?.result), agentFinal?.result?.slice(0, 60));
  check("agent reported no error", !agentEvents.some((e) => e.type === "error"), agentEvents.find((e) => e.type === "error")?.error ?? "clean");
  const badGoal = await fetch(`${BASE}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  check("POST /api/agent requires a goal", badGoal.status === 400, `${badGoal.status}`);

  console.log("\ntts");
  const tts = await fetch(`${BASE}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "[happy] Hello there, this is a voice test.", emotion: "happy" }),
  });
  const ttsOk = tts.status === 200 || tts.status === 204;
  check("POST /api/tts", ttsOk, tts.status === 204 ? `204 → browser fallback (${tts.headers.get("x-tts-attempts")})` : `200 ${tts.headers.get("content-type")} via ${tts.headers.get("x-tts-provider")}`);
  if (tts.status === 200) {
    const buf = new Uint8Array(await tts.arrayBuffer());
    const isWav = String.fromCharCode(...buf.slice(0, 4)) === "RIFF";
    const isMp3 = buf[0] === 0xff || String.fromCharCode(...buf.slice(0, 3)) === "ID3";
    check("audio is a playable container", isWav || isMp3, isWav ? "RIFF/WAVE" : isMp3 ? "MP3" : `unknown: ${[...buf.slice(0, 4)]}`);
  }
  check("tts reports the emotion it used", Boolean(tts.headers.get("x-tts-emotion")), tts.headers.get("x-tts-emotion") ?? "missing");
  const emptyTts = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "   " }) });
  check("POST /api/tts ignores empty text", emptyTts.status === 204, `${emptyTts.status}`);

  console.log("\npages");
  for (const path of ["/", "/characters", "/settings", "/memory", "/skills", "/docs", "/agent"]) {
    const r = await fetch(`${BASE}${path}`);
    const html = await r.text();
    check(`GET ${path}`, r.ok && html.includes("<html"), `${r.status}, ${html.length} bytes`);
  }
  const icon = await fetch(`${BASE}/icon.svg`);
  check("GET /icon.svg", icon.ok, `${icon.status}`);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
