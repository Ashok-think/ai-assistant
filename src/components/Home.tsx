"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CharacterAvatar, { type AvatarEmotion } from "./CharacterAvatar";
import VideoCharacter from "./VideoCharacter";
import Waveform from "./Waveform";
import ActionTimeline from "./ActionTimeline";
import ToolConfirmation from "./ToolConfirmation";
import { createToneAnalyzer, getRecognizerCtor, langToBcp47, matchesWake, normalizeHeard, speak, stopSpeaking, type VoiceSettings } from "@/lib/voice-client";
import { performAction, type ActionState } from "@/lib/client-actions";
import type { ClientAction } from "@/lib/actions";
import { deriveState, emotionForState, stateLabel } from "@/lib/character-state";
import { toDisplayText, correctTranscript } from "@/lib/speech-text";

type AgentStep = "planning" | "searching" | "executing" | "verifying" | "completed" | "failed";
type AgentLogEntry = { id: string; icon: string; text: string; status: "running" | "done" | "failed"; detail?: string; at: number };

type Character = {
  id: number; slug: string; name: string; tagline: string; emoji: string; color: string; accent: string;
  catchphrases: string[]; nickname: string; voice: VoiceSettings; defaultMood: string;
};
type Settings = {
  assistantName: string; wakeWord: string; userName: string; language: string; activeCharacterId: number | null;
  voiceEnabled: boolean; wakeWordEnabled: boolean; freeOnlyMode: boolean; lowPowerMode: boolean; routerMode: string; dailyBudgetUsd: number;
  renderMode?: string; lipSyncEnabled?: boolean;
};
type State = {
  settings: Settings; character: Character; characters: Character[]; greeting: string;
  reminders: { id: number; title: string; dueAt: string }[]; todos: { id: number; title: string }[];
  providers: { tier: string; provider: string; model: string; free: boolean }[]; online: boolean; hasElevenLabs: boolean;
};
type ToolLog = { name: string; args: Record<string, unknown>; result: string };
type Msg = {
  id: string; role: "user" | "assistant"; content: string; emotion?: AvatarEmotion; model?: string; tier?: string;
  costUsd?: number; tokensIn?: number; tokensOut?: number; toolCalls?: ToolLog[]; characterName?: string; pending?: boolean;
};
type RouteInfo = { tier: string; provider: string; model: string; reason: string; complexity: number; estimatedInputTokens: number; budgetUsedUsd: number; budgetUsd: number };

/** A wake word is free text from Settings, so it can contain regex metacharacters. */
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const QUICK = [
  { label: "☀️ Weather", text: "What's the weather in Delhi today?" },
  { label: "⏰ Remind me", text: "Remind me to drink water in 20 minutes" },
  { label: "📝 Todos", text: "Show my todos" },
  { label: "🌐 Open YouTube", text: "open youtube" },
  { label: "🖥️ Read my screen", text: "what's on my screen?" },
  { label: "💬 Check-in", text: "I'm feeling okay today" },
  { label: "🌅 Morning routine", text: "__routine__" },
];

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [emotion, setEmotion] = useState<AvatarEmotion>("happy");
  const [talking, setTalking] = useState(false);
  const [mouth, setMouth] = useState<{ level: number; viseme: "closed" | "mid" | "wide" | "round" }>({ level: 0, viseme: "closed" });
  const [listening, setListening] = useState(false);
  // Live agent activity: the current step/tool driving the character state, plus a real log.
  const [agentStep, setAgentStep] = useState<AgentStep | null>(null);
  const [agentTool, setAgentTool] = useState<string | null>(null);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [wakeArmed, setWakeArmed] = useState(false);
  const [interim, setInterim] = useState("");
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [tone, setTone] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [autoListen, setAutoListen] = useState(false);
  const autoListenRef = useRef(false);
  autoListenRef.current = autoListen;
  const speakingRef = useRef(false); // true while TTS is playing — enables barge-in detection
  const [showChars, setShowChars] = useState(false);
  const [debug, setDebug] = useState(false);
  const [browserStatus, setBrowserStatus] = useState<{ enabled: boolean; playwrightInstalled: boolean; running: boolean; ready: boolean } | null>(null);
  const [androidStatus, setAndroidStatus] = useState<{ enabled: boolean; connected: boolean; accessibilityEnabled: boolean; detail: string } | null>(null);
  const [lastTtsProvider, setLastTtsProvider] = useState<string>("");
  const [ttsFallbackReason, setTtsFallbackReason] = useState<string>(""); // why browser fallback is active
  // Real latency measurements for the debug panel (ms). Populated per turn; never fabricated.
  const [latency, setLatency] = useState<{ sttFinal?: number; firstToken?: number; firstAudio?: number; total?: number } | null>(null);
  const [providerLimit, setProviderLimit] = useState<string>(""); // e.g. "Gemini limit reached…"
  const speechEndRef = useRef<number>(0); // when the mic detected end-of-speech (perf clock)
  const [actions, setActions] = useState<ActionState[]>([]);
  const [confirmReq, setConfirmReq] = useState<{ action: ClientAction; resolve: (ok: boolean) => void } | null>(null);
  const convRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const analyzerStop = useRef<(() => void) | null>(null);
  const stateRef = useRef<State | null>(null);
  stateRef.current = state;

  const load = useCallback(async () => {
    const r = await fetch("/api/state");
    const j = (await r.json()) as State;
    setState(j);
    setVoiceOn(j.settings.voiceEnabled);
    setEmotion((j.character.defaultMood as AvatarEmotion) ?? "happy");
    return j;
  }, []);

  useEffect(() => {
    load().then((j) => {
      setMsgs([{ id: "greet", role: "assistant", content: j.greeting, emotion: j.character.defaultMood as AvatarEmotion, characterName: j.character.name }]);
    });
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("convId") : null;
    if (saved) convRef.current = Number(saved);
  }, [load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, status]);

  // Debug panel pulls the real PC-browser-agent status when opened.
  useEffect(() => {
    if (!debug) return;
    fetch("/api/browser/status").then((r) => r.json()).then(setBrowserStatus).catch(() => setBrowserStatus(null));
    fetch("/api/android/status").then((r) => r.json()).then(setAndroidStatus).catch(() => setAndroidStatus(null));
  }, [debug]);

  const pushToast = useCallback((id: string, text: string) => {
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 12000);
  }, []);

  // `send` and `runAction` call each other (a screen reading feeds a follow-up turn), so the
  // executor reaches `send` through a ref instead of a circular useCallback dependency.
  const sendRef = useRef<((text: string, opts?: { hidden?: boolean }) => Promise<void>) | null>(null);
  const followUpDepth = useRef(0);

  /** Ask the user before navigating somewhere the allowlist doesn't cover. */
  const askConfirm = useCallback(
    (action: ClientAction) => new Promise<boolean>((resolve) => setConfirmReq({ action, resolve })),
    [],
  );

  /** Perform one server-issued action in the browser and record how it went. */
  const runAction = useCallback(
    async (id: string, action: ClientAction) => {
      setActions((prev) => [...prev.slice(-7), { id, action, status: "running", detail: "", at: Date.now() }]);
      const r = await performAction(action, { confirm: askConfirm });
      setActions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: r.ok ? "done" : r.needsTap ? "pending" : "failed", detail: r.detail } : a)),
      );
      // A screen reading is only useful once the assistant has spoken about it, so hand the
      // description straight back for one more turn. Depth-capped so it can't loop.
      if (action.kind === "capture_screen" && r.ok && followUpDepth.current === 0) {
        followUpDepth.current = 1;
        try {
          await sendRef.current?.(
            `Observation from the user's screen: ${r.detail}\n\nUsing only that, answer their question: "${action.question}"`,
            { hidden: true },
          );
        } finally {
          followUpDepth.current = 0;
        }
      }
      return r;
    },
    [askConfirm],
  );

  const retryAction = useCallback(async (a: ActionState) => {
    // This runs from a real click, so the popup blocker lets it through.
    const r = await performAction(a.action);
    setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: r.ok ? "done" : "failed", detail: r.detail } : x)));
  }, []);

  // Proactive engine poll
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/proactive");
        const j = (await r.json()) as { items: { id: string; kind: string; text: string; speak: boolean }[] };
        for (const it of j.items) {
          if (seenRef.current.has(it.id)) continue;
          seenRef.current.add(it.id);
          pushToast(it.id, it.text);
          if (it.speak && voiceOn && stateRef.current) {
            setEmotion("excited");
            speak(it.text, { voice: stateRef.current.character.voice, emotion: "excited", lang: stateRef.current.settings.language, onStart: () => setTalking(true), onEnd: () => setTalking(false), onMouth: setMouth });
          }
        }
      } catch {
        /* ignore */
      }
    };
    tick();
    const h = setInterval(tick, 20000);
    return () => clearInterval(h);
  }, [pushToast, voiceOn]);

  // Filled after startListening is defined; lets `say` re-arm hands-free listening on TTS end.
  const startListenRef = useRef<((mode: "once" | "wake" | "auto") => void) | null>(null);

  const say = useCallback(
    async (text: string, emo: AvatarEmotion, reqStart?: number) => {
      const s = stateRef.current;
      if (!s || !voiceOn) return;
      // In auto mode we KEEP the mic open during TTS so the user can barge in ("Hey Rio" or just
      // start talking). The onresult handler detects speech and interrupts. speakingRef tells that
      // handler to treat input as a barge-in (and it ignores very short/echo-like fragments).
      const wasAuto = autoListenRef.current;
      speakingRef.current = true;
      if (wasAuto && !recRef.current) startListenRef.current?.("auto");
      await speak(text, {
        voice: s.character.voice, emotion: emo, lang: s.settings.language,
        onStart: () => { setTalking(true); if (reqStart) setLatency((l) => ({ ...(l ?? {}), firstAudio: Math.round(performance.now() - reqStart) })); },
        onEnd: () => setTalking(false), onMouth: setMouth,
        onProvider: (p) => { setLastTtsProvider(p); if (p !== "browser") setTtsFallbackReason(""); },
        onFallbackReason: setTtsFallbackReason,
      });
      speakingRef.current = false;
      setTalking(false);
      setMouth({ level: 0, viseme: "closed" });
      // SPEAKING → briefly IDLE → keep listening (mic already open in auto mode).
      if (wasAuto && autoListenRef.current && !recRef.current) {
        setTimeout(() => { if (autoListenRef.current && !recRef.current) startListenRef.current?.("auto"); }, 250);
      }
    },
    [voiceOn],
  );

  const switchCharacter = useCallback(
    async (c: Character, announce = true) => {
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeCharacterId: c.id }) });
      const j = await load();
      convRef.current = null;
      window.localStorage.removeItem("convId");
      const line = `${j.greeting}`;
      setMsgs((m) => [...m, { id: `sw-${Date.now()}`, role: "assistant", content: line, emotion: c.defaultMood as AvatarEmotion, characterName: c.name }]);
      if (announce) say(line, c.defaultMood as AvatarEmotion);
      setShowChars(false);
    },
    [load, say],
  );

  const runRoutine = useCallback(async () => {
    setBusy(true);
    busyRef.current = true;
    setStatus("Running Good Morning routine…");
    try {
      const rs = await fetch("/api/routines").then((r) => r.json() as Promise<{ id: number; name: string }[]>);
      const r = rs.find((x) => /morning/i.test(x.name)) ?? rs[0];
      if (!r) return;
      const res = await fetch("/api/routines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run: true, id: r.id }) }).then((x) => x.json() as Promise<{ summary: string }>);
      setMsgs((m) => [...m, { id: `rt-${Date.now()}`, role: "assistant", content: res.summary, emotion: "excited", characterName: stateRef.current?.character.name }]);
      setEmotion("excited");
      say(res.summary, "excited");
    } finally {
      setBusy(false);
      busyRef.current = false;
      setStatus("");
    }
  }, [say]);

  // E2: analyze an uploaded image through the real vision model. The user's typed text (if any)
  // becomes the question. Result is shown in chat and spoken — honest failure if no vision key.
  const analyzeImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const question = input.trim() || "What is in this image?";
      setInput("");
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("read failed"));
        r.readAsDataURL(file);
      });
      setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: `🖼️ ${file.name} — ${question}` }]);
      const pendingId = `img-${Date.now()}`;
      setMsgs((m) => [...m, { id: pendingId, role: "assistant", content: "", pending: true }]);
      setBusy(true);
      busyRef.current = true;
      setEmotion("thinking");
      try {
        const r = await fetch("/api/vision/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl, question }) });
        const j = (await r.json()) as { description?: string; error?: string };
        const text = r.ok && j.description ? j.description : `I couldn't read that image: ${j.error ?? "vision unavailable"}`;
        const emo: AvatarEmotion = r.ok ? "happy" : "sad";
        setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: text, emotion: emo, characterName: stateRef.current?.character.name } : x)));
        setEmotion(emo);
        say(text, emo);
      } catch (e) {
        setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: `Vision failed: ${e instanceof Error ? e.message : "unknown"}`, emotion: "sad" } : x)));
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [input, say],
  );

  // E4: send a document to the real file assistant (server-side extraction + LLM over the text).
  const analyzeDocFile = useCallback(
    async (file: File) => {
      const question = input.trim() || "Summarize this document and list the key points.";
      setInput("");
      setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: `📄 ${file.name} — ${question}` }]);
      const pendingId = `doc-${Date.now()}`;
      setMsgs((m) => [...m, { id: pendingId, role: "assistant", content: "", pending: true }]);
      setBusy(true);
      busyRef.current = true;
      setEmotion("thinking");
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("question", question);
        const r = await fetch("/api/files", { method: "POST", body: fd });
        const j = (await r.json()) as { answer?: string; error?: string };
        const text = r.ok && j.answer ? j.answer : `I couldn't process that file: ${j.error ?? "unknown error"}`;
        const emo: AvatarEmotion = r.ok ? "happy" : "sad";
        setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: text, emotion: emo, characterName: stateRef.current?.character.name } : x)));
        setEmotion(emo);
        say(text, emo);
      } catch (e) {
        setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: `File read failed: ${e instanceof Error ? e.message : "unknown"}`, emotion: "sad" } : x)));
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [input, say],
  );

  // Route a picked file: images → vision, documents → file assistant.
  const fileAssistantRef = useRef<((f: File) => Promise<void>) | null>(null);
  fileAssistantRef.current = analyzeDocFile;
  const onFilePicked = useCallback(
    (f: File) => {
      if (f.type.startsWith("image/")) return analyzeImageFile(f);
      return fileAssistantRef.current?.(f);
    },
    [analyzeImageFile],
  );

  const send = useCallback(
    async (text: string, opts?: { hidden?: boolean }) => {
      const t = text.trim();
      if (!t || busyRef.current) return;
      const hidden = opts?.hidden ?? false;
      stopSpeaking();
      setTalking(false);
      setMouth({ level: 0, viseme: "closed" });
      // Spoken "stop"/"cancel" is an interrupt, not a message to answer.
      if (/^(stop|cancel|quiet|shush|shut up|be quiet|enough)\b/i.test(t)) {
        chatAbortRef.current?.abort();
        setStatus("");
        return;
      }
      if (t === "__routine__") return runRoutine();

      // Client-side voice command: switch character
      const sw = t.match(/(?:switch|change)\s+(?:to|character to|persona to)\s+([a-z]+)/i) || t.match(/^be\s+([a-z]+)\s*(?:mode|style)?$/i);
      if (sw && stateRef.current) {
        const q = sw[1].toLowerCase();
        const c = stateRef.current.characters.find((x) => x.name.toLowerCase().includes(q) || x.slug.includes(q) || x.tagline.toLowerCase().includes(q));
        if (c) {
          setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: t }]);
          setInput("");
          return switchCharacter(c);
        }
      }

      setInput("");
      setBusy(true);
      busyRef.current = true;
      setAgentStep("planning");
      setAgentTool(null);
      if (!hidden) setAgentLog([]);
      setEmotion("thinking");
      if (!hidden) setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: t }]);
      const pendingId = `a-${Date.now()}`;
      setMsgs((m) => [...m, { id: pendingId, role: "assistant", content: "", pending: true }]);
      const tools: ToolLog[] = [];
      // Actions run after the stream closes: mid-stream the send button is still disabled, and a
      // follow-up turn (screen reading) would deadlock against `busy`.
      const queued: { id: string; action: ClientAction }[] = [];
      const ctl = new AbortController();
      chatAbortRef.current = ctl;
      // Latency instrumentation (real perf-clock timestamps for the debug panel).
      const reqStart = performance.now();
      const sttFinal = speechEndRef.current ? Math.round(reqStart - speechEndRef.current) : undefined;
      let firstTokenAt = 0;
      speechEndRef.current = 0; // consume it
      setLatency({ sttFinal });
      try {
        const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t, conversationId: convRef.current }), signal: ctl.signal });
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const p of parts) {
            if (!p.startsWith("data: ")) continue;
            const ev = JSON.parse(p.slice(6));
            if (ev.type === "route") {
              setRoute(ev.decision);
              setStatus(`Routing → ${ev.decision.tier.toUpperCase()} · ${ev.decision.model}`);
            } else if (ev.type === "status") setStatus(ev.text);
            else if (ev.type === "intent") {
              if (ev.isAction) setStatus(`⚡ ${ev.intent}`);
            } else if (ev.type === "delta") {
              // First token means the wait is over — drop the typing dots and grow the bubble.
              if (!firstTokenAt) { firstTokenAt = performance.now(); setLatency((l) => ({ ...(l ?? {}), firstToken: Math.round(firstTokenAt - reqStart) })); }
              setStatus("");
              setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: x.content + ev.text } : x)));
            } else if (ev.type === "restart") {
              // A provider died partway through. Clear its half-sentence so the fallback's reply
              // doesn't get glued onto it.
              setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: true, content: "" } : x)));
            } else if (ev.type === "quota") {
              // Precise provider limit message (not a generic "failed").
              setProviderLimit(ev.message);
              pushToast(`quota-${Date.now()}`, ev.message);
            } else if (ev.type === "action_step") {
              // Real agent step from the orchestrator — drives the character state machine + log.
              setAgentStep(ev.status as AgentStep);
              const running = ev.status === "planning" || ev.status === "searching" || ev.status === "executing" || ev.status === "verifying";
              setAgentLog((l) => {
                const icon = ev.status === "searching" ? "🔎" : ev.status === "executing" ? "🖱️" : ev.status === "verifying" ? "👀" : ev.status === "completed" ? "✓" : ev.status === "failed" ? "⚠️" : "🧠";
                return [...l.slice(-9), { id: `st-${Date.now()}-${l.length}`, icon, text: ev.step, status: running ? "running" : ev.status === "failed" ? "failed" : "done", at: Date.now() }];
              });
            } else if (ev.type === "action") {
              queued.push({ id: ev.id, action: ev.action });
              setStatus(`⚡ ${ev.action.label}`);
            } else if (ev.type === "tool") {
              tools.push({ name: ev.name, args: ev.args, result: ev.result });
              setAgentTool(ev.name);
              setStatus(`🔧 ${ev.name}`);
              // Log real tool executions (esp. pc_* browser actions) with their result.
              setAgentLog((l) => [...l.slice(-9), { id: `tl-${Date.now()}-${l.length}`, icon: ev.name.startsWith("pc_") ? "🌐" : "🔧", text: ev.name, status: /couldn't|could not|failed|error|not on the allowlist|did not load|unable/i.test(ev.result) ? "failed" : "done", detail: String(ev.result).slice(0, 140), at: Date.now() }]);
              setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, toolCalls: [...tools] } : x)));
            } else if (ev.type === "final") {
              convRef.current = ev.conversationId;
              window.localStorage.setItem("convId", String(ev.conversationId));
              const em = ev.message.emotion as AvatarEmotion;
              setEmotion(em);
              setMsgs((m) =>
                m.map((x) =>
                  x.id === pendingId
                    ? { ...x, pending: false, content: ev.message.content, emotion: em, model: ev.message.model, tier: ev.message.tier, costUsd: ev.message.costUsd, tokensIn: ev.message.tokensIn, tokensOut: ev.message.tokensOut, toolCalls: ev.message.toolCalls, characterName: stateRef.current?.character.name }
                    : x,
                ),
              );
              setStatus("");
              setLatency((l) => ({ ...(l ?? {}), total: Math.round(performance.now() - reqStart) }));
              say(ev.message.content, em, reqStart);
              if (tools.some((x) => /reminder|todo/.test(x.name))) load();
            } else if (ev.type === "error") {
              setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: `Oops: ${ev.error}`, emotion: "sad" } : x)));
              setEmotion("sad");
            }
          }
        }
      } catch (e) {
        // A barge-in abort is intentional — leave whatever was said and quietly stop.
        if (e instanceof DOMException && e.name === "AbortError") {
          setMsgs((m) => m.map((x) => (x.id === pendingId && x.pending ? { ...x, pending: false, content: x.content || "(stopped)" } : x)));
        } else {
          setMsgs((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, content: `Connection hiccup: ${e instanceof Error ? e.message : "unknown"}`, emotion: "sad" } : x)));
        }
      } finally {
        setBusy(false);
        busyRef.current = false;
        chatAbortRef.current = null;
        setStatus("");
        setAgentStep(null);
        setAgentTool(null);
      }
      for (const q of queued) await runAction(q.id, q.action);
    },
    [load, runAction, runRoutine, say, switchCharacter],
  );
  sendRef.current = send;

  // ---- Speech recognition (STT + wake word + interrupt) ----
  const startListening = useCallback(
    (mode: "once" | "wake" | "auto") => {
      const Ctor = getRecognizerCtor();
      if (!Ctor) {
        pushToast("nosr", "Speech recognition isn't supported in this browser. Try Chrome/Edge.");
        return;
      }
      recRef.current?.abort();
      const rec = new Ctor();
      const s = stateRef.current;
      // STT language. The Web Speech API is single-language per session (no true code-switching),
      // so for auto/mixed we use en-IN — it handles Indian-accented English plus many common
      // transliterated Telugu/Hindi words far better than en-US, and the LLM understands the rest.
      const langPref = s?.settings.language ?? "auto";
      rec.lang = langPref === "auto" ? "en-IN" : langToBcp47(langPref);
      // Continuous for wake + auto modes so it keeps listening hands-free.
      rec.continuous = mode === "wake" || mode === "auto";
      rec.interimResults = true;
      // "auto" mode is always awake (no wake word required); "once" is a single push-to-talk.
      let awake = mode === "once" || mode === "auto";
      let finalBuf = "";
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let fatal = false;
      const wake = (s?.settings.wakeWord ?? "hey rio").toLowerCase();
      const wakeName = wake.replace(/^hey\s+/, "").trim() || wake;
      // End-of-speech silence window (configurable). Shorter = snappier auto-submit.
      const silenceMs = mode === "auto" ? 900 : 1400;

      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0].transcript;
          if (r.isFinal) finalBuf += " " + txt;
          else interimText += txt;
        }
        const heard = normalizeHeard(finalBuf + " " + interimText);
        // BARGE-IN. While the assistant is SPEAKING, the mic can pick up its own audio, so require
        // either the wake word or a longer phrase (>~3 words) to treat it as a real interruption —
        // this avoids echo false-triggers. When NOT speaking, any speech is a normal turn.
        const wakeHit = matchesWake(finalBuf + " " + interimText, (s?.settings.wakeWord ?? "hey rio")).hit;
        const looksIntentional = wakeHit || heard.split(" ").length >= 3;
        if (speakingRef.current && looksIntentional) {
          // Immediately clear queued/playing TTS + lip-sync so old audio can't leak into the new turn.
          stopSpeaking();
          speakingRef.current = false;
          setTalking(false);
          setMouth({ level: 0, viseme: "closed" });
          if (busyRef.current && chatAbortRef.current) { chatAbortRef.current.abort(); chatAbortRef.current = null; }
        } else if (!speakingRef.current && heard.length > 2 && busyRef.current && chatAbortRef.current) {
          // Not speaking but a run is in-flight (thinking) and the user talks → cancel + relisten.
          stopSpeaking();
          setTalking(false);
          chatAbortRef.current.abort();
          chatAbortRef.current = null;
        }
        if (!awake) {
          // Fuzzy, punctuation-tolerant wake match (handles "Hey, Rio!" and small mis-hears).
          const m = matchesWake(finalBuf + " " + interimText, wake);
          if (m.hit) {
            awake = true;
            setEmotion("excited");
            setStatus("Yes? I'm listening…");
            finalBuf = m.rest ? ` ${m.rest}` : "";
          } else {
            setInterim("");
            return;
          }
        }
        // Once awake, strip any lingering wake word out of the running buffer.
        const shown = normalizeHeard(
          (finalBuf + " " + interimText)
            .replace(new RegExp(reEscape(wake), "gi"), " ")
            .replace(new RegExp(reEscape(wakeName), "gi"), " "),
        );
        setInterim(shown);
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          const cmd = normalizeHeard(
            finalBuf.replace(new RegExp(reEscape(wake), "gi"), " ").replace(new RegExp(reEscape(wakeName), "gi"), " "),
          );
          // End-of-speech: finalize + auto-submit (no Send button). Require a couple of words so
          // stray noise doesn't fire a request. Light brand-name correction on the transcript.
          if (cmd && cmd.length > 1) { speechEndRef.current = performance.now(); send(correctTranscript(cmd)); }
          finalBuf = "";
          setInterim("");
          if (mode === "once") rec.stop();
          else if (mode === "wake") {
            // Back to sleep until the wake word is heard again.
            awake = false;
            setStatus("");
          } else {
            // auto: stay awake and keep listening for the next utterance.
            setStatus("");
          }
        }, silenceMs);
      };
      rec.onerror = (e) => {
        // Permission problems are permanent until the user acts, so don't let `onend` respawn.
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          fatal = true;
          recRef.current = null;
          setListening(false);
          setWakeArmed(false);
          pushToast("mic", "Microphone permission denied. Enable it in the browser, then tap Wake word again.");
        } else if (e.error === "network") {
          // Chrome's Web Speech API is cloud-based — no network means no STT.
          pushToast("stt-net", "Speech recognition needs internet (Chrome sends audio to Google). Check your connection.");
        } else if (e.error === "audio-capture") {
          fatal = true;
          pushToast("stt-mic", "No microphone found. Plug one in or check your OS sound settings.");
        }
        // `no-speech` and `aborted` are normal in wake mode; onend will respawn.
      };
      rec.onend = () => {
        // Wake mode has to survive Chrome ending the session on every silence gap. Restarting
        // synchronously inside `onend` throws InvalidStateError, so wait a beat — and bail if
        // `stopListening` ran in the meantime, otherwise the mic can never be turned off.
        if ((mode === "wake" || mode === "auto") && !fatal && recRef.current === rec) {
          setTimeout(() => {
            if (recRef.current !== rec) return;
            try {
              rec.start();
            } catch {
              recRef.current = null;
              setListening(false);
              setWakeArmed(false);
            }
          }, 400);
        } else {
          setListening(false);
          setInterim("");
        }
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        // Already-started is the only realistic throw here, and it means we're listening anyway.
      }
      setListening(true);
      if (mode === "wake" || mode === "auto") setWakeArmed(true);
      if (!analyzerStop.current) {
        createToneAnalyzer((lvl, t) => { setMicLevel(lvl); setTone(t); }).then((stop) => { analyzerStop.current = stop; }).catch(() => {});
      }
    },
    [pushToast, send],
  );

  const stopListening = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    r?.abort();
    setListening(false);
    setWakeArmed(false);
    setInterim("");
    analyzerStop.current?.();
    analyzerStop.current = null;
    setMicLevel(0);
  }, []);

  // Let `say` (defined earlier) re-arm listening after TTS via a ref, avoiding a circular dep.
  startListenRef.current = startListening;

  // AUTO LISTEN toggle: when on, preflight the mic + audio, then start hands-free listening.
  useEffect(() => {
    if (autoListen) {
      (async () => {
        // Preflight microphone permission with a clear message on failure (no silent fail).
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch (err) {
          const name = (err as DOMException)?.name;
          pushToast("mic-auto", name === "NotAllowedError"
            ? "Microphone permission denied — enable it in the browser to use Auto Listen."
            : name === "NotFoundError"
              ? "No microphone found. Connect one and try again."
              : "Couldn't access the microphone for Auto Listen.");
          setAutoListen(false);
          return;
        }
        // Autoplay/AudioContext need a user gesture — the toggle click counts. Warm the context.
        try {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AC) { const c = new AC(); if (c.state === "suspended") await c.resume(); c.close(); }
        } catch { /* ignore */ }
        if (!recRef.current && !busyRef.current && !talking) startListening("auto");
      })();
    } else {
      // Only stop if we're in a hands-free session (don't kill a push-to-talk).
      if (wakeArmed) stopListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen]);

  // Turning the wake word on in Settings has to actually arm the mic — until now the only thing
  // that ever called startListening("wake") was the button, so the setting looked broken.
  // Browsers reject getUserMedia without a user gesture on a fresh load, so if the first attempt
  // is refused we say so and let the button take over.
  const autoArmed = useRef(false);
  useEffect(() => {
    if (!state?.settings.wakeWordEnabled) {
      autoArmed.current = false;
      return;
    }
    if (autoArmed.current || recRef.current) return;
    const t = setTimeout(() => {
      autoArmed.current = true;
      startListening("wake");
    }, 600);
    return () => clearTimeout(t);
  }, [state?.settings.wakeWordEnabled, startListening]);

  if (!state) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="text-center">
          <div className="glow-ring mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-violet-600 to-cyan-400 anim-pulse-glow" />
          <p className="text-sm text-slate-400">Booting companion core…</p>
        </div>
      </div>
    );
  }

  const c = state.character;
  const budgetPct = route ? Math.min(100, (route.budgetUsedUsd / Math.max(0.01, route.budgetUsd)) * 100) : 0;

  // Real-time character state derived from actual voice + agent signals (no decorative timers).
  const charState = deriveState({ listening, talking, busy, step: agentStep, tool: agentTool });
  const charEmotion = talking ? emotion : emotionForState(charState, emotion);
  const stateHud = stateLabel(charState, agentTool);

  return (
    <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[420px_1fr]">
      {/* LEFT: Character HUD */}
      <section className="panel relative overflow-hidden p-5">
        <div className="hud-grid absolute inset-0 opacity-70" />
        <div className="relative">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-300/80">Active persona</div>
              <h1 className="mt-1 text-2xl font-semibold neon-text" style={{ color: c.accent }}>{c.name}</h1>
              <p className="text-xs text-slate-400">{c.tagline}</p>
            </div>
            <button className="btn btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setShowChars((v) => !v)}>🎭 Switch</button>
          </div>

          {showChars && (
            <div className="anim-fade-up mt-3 grid grid-cols-4 gap-2">
              {state.characters.map((ch) => (
                <button key={ch.id} onClick={() => switchCharacter(ch)} className={`flex flex-col items-center rounded-xl border p-2 text-[10px] transition hover:bg-white/10 ${ch.id === c.id ? "border-cyan-400/60 bg-white/10" : "border-white/10"}`}>
                  <span className="text-xl">{ch.emoji}</span>
                  <span className="mt-1 truncate text-slate-200">{ch.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex justify-center">
            {state.settings.renderMode === "video" ? (
              <VideoCharacter emotion={charEmotion} talking={talking} listening={listening} size={280} accent={c.accent} />
            ) : (
              <CharacterAvatar color={c.color} accent={c.accent} emoji={c.emoji} emotion={charEmotion} talking={talking} listening={listening} size={280} mouthLevel={state.settings.lipSyncEnabled === false ? 0 : mouth.level} viseme={mouth.viseme} />
            )}
          </div>

          <div className="mt-1 flex items-center justify-center gap-2 text-xs text-slate-400">
            <span className={`chip ${charState === "error" ? "text-rose-300" : charState === "success" ? "text-emerald-300" : charState === "idle" ? "" : "text-cyan-300"}`}>{stateHud.icon} {stateHud.text}</span>
            <span className="chip">mood: {charEmotion}</span>
            {talking && <span className="chip text-cyan-300">speaking{lastTtsProvider ? ` · ${lastTtsProvider}` : ""}</span>}
            {lastTtsProvider === "browser" && ttsFallbackReason && <span className="chip text-amber-300" title={ttsFallbackReason}>browser fallback</span>}
            {listening && <span className="chip text-emerald-300">{autoListen ? "auto-listening" : wakeArmed ? `listening for "${state.settings.wakeWord}"` : "listening"}</span>}
            {tone && listening && <span className="chip">tone: {tone}</span>}
          </div>

          <Waveform active={talking || (listening && micLevel > 0.05)} color={talking ? c.accent : "#22d3ee"} level={talking ? 1 : Math.max(0.3, micLevel * 2)} />
          {interim && <p className="mt-1 text-center text-xs italic text-cyan-200/80">“{interim}”</p>}

          {/* AUTO LISTEN — hands-free continuous conversation (no Talk button needed). */}
          <button
            className={`btn mt-3 w-full ${autoListen ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setAutoListen((v) => !v)}
            title="Hands-free: JARVIS listens, detects end of speech, and replies automatically"
          >
            {autoListen ? "🎧 Auto Listen: ON (hands-free)" : "🎧 Auto Listen: OFF"}
          </button>

          {/* Voice controls */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              className={`btn ${listening && !wakeArmed ? "btn-primary" : "btn-ghost"}`}
              onClick={() => (listening && !wakeArmed ? stopListening() : startListening("once"))}
              disabled={busy || autoListen}
              title="Push to talk"
            >
              🎙️ {listening && !wakeArmed ? "Stop" : "Talk"}
            </button>
            <button className={`btn ${wakeArmed ? "btn-primary" : "btn-ghost"}`} onClick={() => (wakeArmed ? stopListening() : startListening("wake"))} title="Always-on wake word">
              👂 {wakeArmed ? "Armed" : "Wake word"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setVoiceOn((v) => !v); stopSpeaking(); setTalking(false); setMouth({ level: 0, viseme: "closed" }); chatAbortRef.current?.abort(); }}>
              {voiceOn ? "🔊 Voice on" : "🔇 Muted"}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            {autoListen
              ? "Just speak — I'll detect when you finish and reply. Talk over me to interrupt."
              : <>Say <span className="text-cyan-300">“{state.settings.wakeWord}”</span> · “switch to {state.characters.find((x) => x.id !== c.id)?.name ?? "Sora"}” · talk over me to interrupt</>}
          </p>

          {/* Router HUD */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-400">
              <span>Token router</span>
              <span className={state.online ? "text-emerald-300" : "text-amber-300"}>{state.online ? `${state.providers.length} models online` : "offline engine"}</span>
            </div>
            {route ? (
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex flex-wrap gap-1">
                  <span className="chip text-violet-200">{route.tier}</span>
                  <span className="chip">{route.provider}/{route.model}</span>
                  <span className="chip">complexity {(route.complexity * 100).toFixed(0)}%</span>
                  <span className="chip">~{route.estimatedInputTokens} tok in</span>
                </div>
                <p className="text-[11px] text-slate-400">{route.reason}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-amber-400" style={{ width: `${budgetPct}%` }} />
                </div>
                <div className="text-[10px] text-slate-500">Budget today ${route.budgetUsedUsd.toFixed(4)} / ${route.budgetUsd.toFixed(2)}</div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-500">
                {state.online ? `Auto-routes each message: quick chat → fast model, hard tasks → smart model.` : "No API key yet — running the built-in offline persona engine. Add a free Groq key in Settings for the full brain."}
              </p>
            )}
          </div>

          {/* Debug panel — every value here is a real runtime signal, not a mock. */}
          <div className="mt-3">
            <button className="text-[10px] uppercase tracking-widest text-slate-500 hover:text-slate-300" onClick={() => setDebug((v) => !v)}>
              {debug ? "▾ Hide debug" : "▸ Debug"}
            </button>
            {debug && (
              <div className="mt-1 space-y-1 rounded-xl border border-white/10 bg-black/40 p-2.5 font-mono text-[10px] text-slate-300">
                <div>MODEL: {route ? `${route.provider}/${route.model} (${route.tier})` : "—"}</div>
                {providerLimit && <div className="text-amber-300">PROVIDER LIMIT: {providerLimit}</div>}
                <div>CHAR STATE: {charState}{agentStep ? ` · step=${agentStep}` : ""}</div>
                <div>CURRENT TOOL: {agentTool ?? "—"}</div>
                <div>TTS PROVIDER: {lastTtsProvider || "—"}{lastTtsProvider === "browser" && ttsFallbackReason ? ` (fallback: ${ttsFallbackReason})` : ""}</div>
                <div>LIP SYNC: {talking ? `active (${mouth.viseme} ${(mouth.level * 100).toFixed(0)}%)` : "idle"}</div>
                <div>
                  PC BROWSER:{" "}
                  {browserStatus
                    ? `${browserStatus.ready ? "ready" : "not ready"} · pw=${browserStatus.playwrightInstalled} · skill=${browserStatus.enabled} · running=${browserStatus.running}`
                    : "…"}
                </div>
                <div>
                  ANDROID:{" "}
                  {androidStatus
                    ? `${androidStatus.connected ? "connected" : androidStatus.enabled ? "not connected" : "skill off"} · ${androidStatus.detail}`
                    : "…"}
                </div>
                <div className="text-cyan-300/90">
                  LATENCY: {latency ? [
                    latency.sttFinal != null ? `STT ${latency.sttFinal}ms` : null,
                    latency.firstToken != null ? `AI 1st token ${latency.firstToken}ms` : null,
                    latency.firstAudio != null ? `TTS 1st audio ${latency.firstAudio}ms` : null,
                    latency.total != null ? `total ${latency.total}ms` : null,
                  ].filter(Boolean).join(" · ") || "measuring…" : "— (speak to measure)"}
                </div>
                <div>VOICE: {voiceOn ? "on" : "muted"} · LISTENING: {String(listening)} · BUSY: {String(busy)}</div>
              </div>
            )}
          </div>

          {/* Glance widgets */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-white/10 bg-black/20 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">Upcoming</div>
              {state.reminders.length ? state.reminders.slice(0, 3).map((r) => <div key={r.id} className="truncate text-slate-300">⏰ {r.title} · {new Date(r.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>) : <div className="text-slate-500">No reminders</div>}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">To-do</div>
              {state.todos.length ? state.todos.slice(0, 3).map((t) => <div key={t.id} className="truncate text-slate-300">☐ {t.title}</div>) : <div className="text-slate-500">All clear</div>}
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT: Chat */}
      <section className="panel flex min-h-[70vh] flex-col p-4 lg:h-[calc(100vh-2rem)]">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-200">Chat with {state.settings.assistantName} <span className="text-slate-500">as {c.name}</span></div>
          <button className="text-xs text-slate-400 hover:text-white" onClick={() => { convRef.current = null; window.localStorage.removeItem("convId"); setMsgs([{ id: "greet", role: "assistant", content: state.greeting, emotion: c.defaultMood as AvatarEmotion, characterName: c.name }]); }}>+ New chat</button>
        </div>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
          {msgs.map((m) => (
            <div key={m.id} className={`anim-fade-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "bg-gradient-to-br from-violet-600/80 to-fuchsia-600/70 text-white" : "border border-white/10 bg-white/5 text-slate-100"}`}>
                {m.role === "assistant" && <div className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: c.accent }}>{m.characterName ?? c.name}{m.emotion ? ` · ${m.emotion}` : ""}</div>}
                {m.pending ? (
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:240ms]" />
                    <span className="text-xs">{status || "thinking…"}</span>
                  </div>
                ) : (
                  <div className="prose-chat whitespace-pre-wrap">{m.role === "assistant" ? toDisplayText(m.content) : m.content}</div>
                )}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-cyan-300">🔧 {m.toolCalls.length} tool call{m.toolCalls.length > 1 ? "s" : ""}: {m.toolCalls.map((t) => t.name).join(", ")}</summary>
                    <div className="mt-1 space-y-1">
                      {m.toolCalls.map((t, i) => (
                        <div key={i} className="rounded-lg bg-black/30 p-2">
                          <div className="font-mono text-[11px] text-violet-200">{t.name}({JSON.stringify(t.args)})</div>
                          <div className="mt-1 whitespace-pre-wrap text-slate-300">{t.result}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {m.model && (
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    <span>{m.tier} · {m.model}</span>
                    <span>· {m.tokensIn}↑ {m.tokensOut}↓</span>
                    <span>· ${m.costUsd?.toFixed(5)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {agentLog.length > 0 && (
          <div className="mt-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.04] p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-violet-300/80">
              <span>Agent activity</span>
              <span className="text-slate-500">{agentLog.filter((a) => a.status === "done").length}/{agentLog.length}</span>
            </div>
            <ul className="space-y-1">
              {agentLog.map((a) => (
                <li key={a.id} className="anim-fade-up flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 ${a.status === "failed" ? "text-rose-300" : a.status === "running" ? "text-cyan-300 animate-pulse" : "text-emerald-300"}`}>{a.icon}</span>
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-slate-200">{a.text}</span>
                    {a.detail && <p className={`break-words ${a.status === "failed" ? "text-rose-300/80" : "text-slate-400"}`}>{a.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ActionTimeline actions={actions} onRetry={retryAction} onDismiss={(id) => setActions((a) => a.filter((x) => x.id !== id))} />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q.label} className="chip hover:bg-white/10" onClick={() => send(q.text)} disabled={busy}>{q.label}</button>
          ))}
        </div>

        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input className="input" placeholder={`Message ${c.name}… (English / Hindi / Hinglish / 日本語)`} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.docx,.txt,.csv,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePicked(f); e.target.value = ""; }} />
          <button type="button" className="btn btn-ghost" title="Attach image or document" onClick={() => fileInputRef.current?.click()} disabled={busy}>📎</button>
          <button type="button" className={`btn ${listening ? "btn-primary" : "btn-ghost"}`} onClick={() => (listening ? stopListening() : startListening("once"))}>🎙️</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
        </form>
      </section>

      {/* Toasts (proactive notifications) */}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="panel anim-fade-up pointer-events-auto flex items-start gap-2 p-3 text-sm">
            <span className="text-lg">{c.emoji}</span>
            <div className="flex-1 text-slate-100">{t.text}</div>
            <button className="text-slate-500 hover:text-white" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      <ToolConfirmation
        action={confirmReq?.action ?? null}
        onAllow={() => { confirmReq?.resolve(true); setConfirmReq(null); }}
        onDeny={() => { confirmReq?.resolve(false); setConfirmReq(null); }}
      />
    </div>
  );
}
