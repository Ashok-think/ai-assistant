import test from "node:test";
import assert from "node:assert/strict";
import { VoiceSession, matchesWake, readTranscript } from "../src/lib/voice-session.ts";

function fixture(overrides = {}) {
  let now = 1000, id = 0, occupied = false, interrupts = 0, stoppedTracks = 0;
  const timers = new Map(), recognizers = [], commands = [], snapshots = [];
  const session = new VoiceSession({
    create: () => {
      const rec = { start() {}, stop() {}, abort() { this.aborted = true; }, onstart: null, onresult: null, onend: null, onerror: null };
      recognizers.push(rec);
      return rec;
    },
    permission: async () => ({ getTracks: () => [{ stop() { stoppedTracks++; } }] }),
    onChange: (snapshot) => snapshots.push(snapshot),
    onCommand: (text) => commands.push(text),
    onInterrupt: () => { interrupts++; occupied = false; },
    isOccupied: () => occupied,
    setTimer: (callback, ms) => { const key = ++id; timers.set(key, { callback, at: now + ms }); return key; },
    clearTimer: (key) => timers.delete(key),
    now: () => now,
    ...overrides,
  });
  return {
    session, recognizers, commands, timers,
    get state() { return snapshots.at(-1); },
    get interrupts() { return interrupts; },
    get stoppedTracks() { return stoppedTracks; },
    occupy() { occupied = true; },
    async start(mode = "wake") { await session.start(mode, "hey rio", "en-IN"); },
    result(parts, rec = recognizers.at(-1)) { rec.onresult?.({ resultIndex: 0, results: parts.map(([transcript, isFinal = true]) => ({ 0: { transcript }, isFinal })) }); },
    tick(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = target;
    },
  };
}

test("full wake phrase uses word boundaries and preserves command text", () => {
  for (const phrase of ["Hey, Rio!", "hey reo", "hey ryo"]) assert.deepEqual(matchesWake(`${phrase} Find Rio hotels!`, ""), { hit: true, rest: "Find Rio hotels!" });
  for (const text of ["priority", "Rio hotels", "hey radio", "hey riot", "hey rich", "try this", "hey nova"]) assert.equal(matchesWake(text, "hey rio").hit, false, text);
  assert.equal(matchesWake("Hello, Atlas. Read this.", "hello atlas").rest, "Read this.");
  assert.equal(matchesWake("Atlas", "hello atlas").hit, false);
});

test("indexed results replace interim hypotheses instead of appending", () => {
  assert.deepEqual(readTranscript([{ 0: { transcript: "Hey Rio" }, isFinal: true }, { 0: { transcript: "search" }, isFinal: false }]), { final: "Hey Rio", interim: "search" });
});

test("starting is not listening until onstart", async () => {
  const f = fixture(); await f.start(); assert.equal(f.state.phase, "starting");
  assert.equal(f.stoppedTracks, 1);
  f.recognizers[0].onstart(); assert.equal(f.state.phase, "wake-listening"); f.session.stop();
});

test("thrown start and permission denial do not claim listening", async () => {
  const a = fixture({ create: () => ({ start() { throw new DOMException("busy", "InvalidStateError"); }, abort() {} }) });
  await a.start(); assert.equal(a.state.phase, "error"); assert.equal(a.timers.size, 0);
  const b = fixture({ permission: async () => { throw new DOMException("denied", "NotAllowedError"); } });
  await b.start(); assert.equal(b.state.permission, "denied"); assert.equal(b.recognizers.length, 0);
});

test("wake plus command submits once after final, not interim", async () => {
  const f = fixture(); await f.start(); f.recognizers[0].onstart();
  f.result([["Hey Rio find Rome", false]]); f.tick(1400); assert.deepEqual(f.commands, []);
  f.result([["Hey Rio Find Rio hotels!", true]]);
  const stale = f.recognizers[0].onresult;
  f.result([["Hey Rio Find Rio hotels!", true]]); f.tick(1200);
  stale({ results: [{ 0: { transcript: "Hey Rio duplicate" }, isFinal: true }] });
  assert.deepEqual(f.commands, ["Find Rio hotels!"]); f.session.stop();
});

test("wake can span indexed result boundaries", async () => {
  const f = fixture(); await f.start(); f.result([["Hey"], ["Rio list my tasks"]]); f.recognizers[0].onend();
  assert.deepEqual(f.commands, ["list my tasks"]); f.session.stop();
});

test("bare wake waits for a command across recognition restarts", async () => {
  const f = fixture(); await f.start(); f.result([["Hey Rio"]]); f.recognizers[0].onend(); f.tick(400);
  assert.deepEqual(f.commands, []);
  f.result([["Add milk to my list"]]); f.recognizers.at(-1).onend();
  assert.deepEqual(f.commands, ["Add milk to my list"]); f.session.stop();
});

test("bare wake expires without sending an empty request", async () => {
  const f = fixture(); await f.start(); f.result([["Hey Rio"]]); f.tick(8000);
  f.result([["unrelated conversation"]]); f.tick(1300);
  assert.deepEqual(f.commands, []); f.session.stop();
});

test("ambient speech does not cancel work; explicit stop does", async () => {
  const f = fixture(); await f.start(); f.occupy(); f.result([["ambient chat"]]);
  assert.equal(f.interrupts, 0); f.result([["ambient chat"], ["stop"]]);
  assert.equal(f.interrupts, 1); assert.deepEqual(f.commands, ["stop"]); f.session.stop();
});

test("stop cancels restart timers and guards stale event callbacks", async () => {
  const f = fixture(); await f.start(); const stale = f.recognizers[0].onend;
  stale(); f.session.stop(); stale(); f.tick(20000);
  assert.equal(f.recognizers.length, 1); assert.equal(f.state.phase, "stopped"); assert.equal(f.timers.size, 0);
});

test("pending permission completion cannot revive a stopped session", async () => {
  let resolve; let stopped = 0;
  const f = fixture({ permission: () => new Promise((r) => { resolve = r; }) });
  const pending = f.start(); f.session.stop();
  resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.equal(f.recognizers.length, 0); assert.equal(f.state.phase, "stopped");
});

test("rapid mode changes retain only the latest permission attempt", async () => {
  const resolvers = [];
  const f = fixture({ permission: () => new Promise((resolve) => resolvers.push(resolve)) });
  const first = f.start("wake"), second = f.start("auto");
  resolvers[1]({ getTracks: () => [] }); await second;
  resolvers[0]({ getTracks: () => [] }); await first;
  assert.equal(f.recognizers.length, 1); assert.equal(f.state.mode, "auto"); f.session.stop();
});

test("network retries back off and stop after the retry budget", async () => {
  const f = fixture(); await f.start();
  for (let i = 0; i < 5; i++) { const rec = f.recognizers.at(-1); rec.onstart(); rec.onerror({ error: "network" }); rec.onend(); f.tick(5000); }
  assert.equal(f.state.phase, "error"); assert.match(f.state.error, /internet/); assert.equal(f.recognizers.length, 5);
});

test("push to talk needs no wake phrase and returns to idle", async () => {
  const f = fixture(); await f.start("once"); f.result([["Take a note"]]); f.recognizers[0].onend();
  assert.deepEqual(f.commands, ["Take a note"]); assert.equal(f.state.phase, "idle");
});

test("wake expiry cancels a pending restart instead of opening two recognizers", async () => {
  const f = fixture(); await f.start(); f.recognizers[0].onstart();
  f.result([["Hey Rio"]]); f.tick(7800); f.recognizers[0].onend();
  f.tick(400);
  assert.equal(f.recognizers.length, 2);
  assert.equal(f.recognizers.filter((rec) => !rec.aborted).length, 1);
  f.session.stop();
});

test("push-to-talk retains network errors after recognition ends", async () => {
  const f = fixture(); await f.start("once");
  f.recognizers[0].onerror({ error: "network" }); f.recognizers[0].onend();
  assert.equal(f.state.phase, "error"); assert.match(f.state.error, /internet/);
  assert.equal(f.timers.size, 0);
});

test("an interrupt handler that stops the session cannot dispatch a command", async () => {
  const f = fixture({ onInterrupt: () => f.session.stop() }); await f.start();
  f.result([["Hey Rio do not dispatch"]]); f.tick(20000);
  assert.equal(f.state.phase, "stopped"); assert.deepEqual(f.commands, []); assert.equal(f.timers.size, 0);
});

test("service errors without an end event terminate after a bounded fallback", async () => {
  const f = fixture(); await f.start("once");
  f.recognizers[0].onerror({ error: "network" }); f.tick(1000);
  assert.equal(f.state.phase, "error"); assert.equal(f.timers.size, 0);
});

test("interim wake or stop hypotheses never interrupt TTS", async () => {
  const f = fixture(); await f.start("auto"); f.occupy();
  f.result([["stop", false]]); f.result([["Hey Rio", false]]); f.tick(2000);
  assert.equal(f.interrupts, 0); assert.deepEqual(f.commands, []); f.session.stop();
});

test("duplicate final events do not postpone a ready command", async () => {
  const f = fixture(); await f.start(); f.result([["Hey Rio take a note"]]);
  f.tick(1000); f.result([["Hey Rio take a note"]]); f.tick(200);
  assert.deepEqual(f.commands, ["take a note"]); f.session.stop();
});

test("late results after a network error cannot submit", async () => {
  const f = fixture(); await f.start(); f.recognizers[0].onerror({ error: "network" });
  f.result([["Hey Rio stale command"]]); f.tick(1200);
  assert.deepEqual(f.commands, []); f.session.stop();
});

test("interim-only sessions cannot reset the restart budget", async () => {
  const f = fixture(); await f.start();
  for (let i = 0; i < 5; i++) { f.result([["unfinished", false]]); f.recognizers.at(-1).onend(); f.tick(5000); }
  assert.equal(f.state.phase, "error"); assert.equal(f.recognizers.length, 5);
});

test("start timeout never claims active listening", async () => {
  const f = fixture(); await f.start(); f.tick(10000);
  assert.equal(f.state.phase, "error"); assert.match(f.state.error, /start-timeout/); assert.equal(f.timers.size, 0);
});

test("fatal microphone error detaches callbacks and all timers", async () => {
  const f = fixture(); await f.start(); f.recognizers[0].onerror({ error: "audio-capture" }); f.tick(20000);
  assert.equal(f.state.phase, "error"); assert.equal(f.recognizers[0].onend, null); assert.equal(f.timers.size, 0);
});
