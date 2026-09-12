"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEmotion } from "./CharacterAvatar";
import CompanionStage from "./CompanionStage";
import Link from "next/link";
import { ArrowUp, ArrowUpRight, AudioLines, ChevronDown, Mic, Paperclip, Plus, Radio, SlidersHorizontal, Square, Volume2, VolumeX } from "lucide-react";
import Waveform from "./Waveform";
import ActionTimeline from "./ActionTimeline";
import ToolConfirmation from "./ToolConfirmation";
import { speak, stopSpeaking, type VoiceSettings } from "@/lib/voice-client";
import { useVoiceSession } from "./useVoiceSession";
import VoiceDiagnostics from "./VoiceDiagnostics";
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
  ttsProvider: string; ttsModel: string; ttsVoice: string; voiceSpeed?: number; localLatencyTargetMs?: number; apiLatencyTargetMs?: number; chatModelMode: string; chatProvider: string | null; chatModel: string | null; thinkingModelMode: string; thinkingProvider: string | null; thinkingModel: string | null;
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
type ModelOption = { id: string; provider: string; model: string; tier: string; capability: string; configured: boolean; label: string };



const QUICK = [
  { label: "Plan my day", text: "Help me plan my day using my todos and reminders." },
  { label: "Read my screen", text: "what's on my screen?" },
  { label: "Open YouTube", text: "open youtube" },
  { label: "Set a reminder", text: "Remind me to drink water in 20 minutes" },
];

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [models, setModels] = useState<{ thinking: ModelOption[]; chat: ModelOption[]; audio: ModelOption[] }>({ thinking: [], chat: [], audio: [] });
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [emotion, setEmotion] = useState<AvatarEmotion>("happy");
  const [talking, setTalking] = useState(false);
  const [mouth, setMouth] = useState<{ level: number; viseme: "closed" | "mid" | "wide" | "round" }>({ level: 0, viseme: "closed" });

  // Live agent activity: the current step/tool driving the character state, plus a real log.
  const [agentStep, setAgentStep] = useState<AgentStep | null>(null);
  const [agentTool, setAgentTool] = useState<string | null>(null);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);

  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const speakingRef = useRef(false); // true while TTS is playing — enables barge-in detection
  const lastSpokenRef = useRef("");
  const voiceCaptureMuteUntilRef = useRef(0);
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
  const responseGenerationRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const seenRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const stateRef = useRef<State | null>(null);
  stateRef.current = state;

  const load = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    const body = await r.text();
    if (!r.ok) throw new Error(`State request failed (${r.status})${body ? `: ${body.slice(0, 160)}` : ""}`);
    if (!body.trim()) throw new Error("State request returned an empty response");
    const j = JSON.parse(body) as State;
    setState(j);
    setVoiceOn(j.settings.voiceEnabled);
    setEmotion((j.character.defaultMood as AvatarEmotion) ?? "happy");
    return j;
  }, []);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((j) => setModels(j.slots ?? { thinking: [], chat: [], audio: [] })).catch(() => undefined);
    load().then((j) => {
      setMsgs([{ id: "greet", role: "assistant", content: j.greeting, emotion: j.character.defaultMood as AvatarEmotion, characterName: j.character.name }]);
    }).catch((error) => {
      console.error("[v0] Failed to load assistant state:", error);
      setStatus("State unavailable. Retrying…");
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

  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pushToast = useCallback((id: string, text: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    setToasts((current) => [...current.filter((item) => item.id !== id), { id, text }].slice(-3));
    toastTimersRef.current.set(id, setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
      toastTimersRef.current.delete(id);
    }, 5200));
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
      setActions((prev) => {
        const signature = JSON.stringify(action);
        const duplicate = prev.some((item) => JSON.stringify(item.action) === signature && Date.now() - item.at < 15000);
        if (duplicate) return prev;
        return [...prev.slice(-7), { id, action, status: "running", detail: "", at: Date.now() }];
      });
      const r = await performAction(action, { confirm: askConfirm });
      const nextStatus = r.ok ? "done" : r.needsTap ? "pending" : "failed";
      setActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: nextStatus, detail: r.detail } : a)));
      if (r.ok) setTimeout(() => setActions((prev) => prev.filter((a) => a.id !== id)), 5000);
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
    const r = await performAction(a.action, { userInitiated: true });
    setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: r.ok ? "done" : "failed", detail: r.detail } : x)));
      if (r.ok) setTimeout(() => setActions((prev) => prev.filter((x) => x.id !== a.id)), 5000);
      else if (/blocked|pairing|authentication|not configured|not available/i.test(r.detail)) pushToast(`action-${a.id}`, r.detail);
  }, [pushToast]);

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
            speak(it.text, { voice: { ...stateRef.current.character.voice, rate: (stateRef.current.character.voice.rate ?? 1) * (stateRef.current.settings.voiceSpeed ?? 1), localVoiceName: typeof window !== "undefined" ? window.localStorage.getItem("jarvish-local-voice") ?? undefined : undefined, localLatencyTargetMs: stateRef.current.settings.localLatencyTargetMs, apiLatencyTargetMs: stateRef.current.settings.apiLatencyTargetMs }, emotion: "excited", lang: stateRef.current.settings.language, onStart: () => setTalking(true), onEnd: () => setTalking(false), onMouth: setMouth });
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



  const say = useCallback(
    async (text: string, emo: AvatarEmotion, reqStart?: number) => {
      const s = stateRef.current;
      if (!s || !voiceOn) return;
      // In auto mode we KEEP the mic open during TTS so the user can barge in ("Hey Rio" or just
      // start talking). The onresult handler detects speech and interrupts. speakingRef tells that
      // handler to treat input as a barge-in (and it ignores very short/echo-like fragments).
      speakingRef.current = true;
      lastSpokenRef.current = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      voiceCaptureMuteUntilRef.current = Date.now() + Math.max(800, Math.min(8000, text.length * 45));
      await speak(text, {
        voice: { ...s.character.voice, rate: (s.character.voice.rate ?? 1) * (s.settings.voiceSpeed ?? 1), localVoiceName: typeof window !== "undefined" ? window.localStorage.getItem("jarvish-local-voice") ?? undefined : undefined, localLatencyTargetMs: s.settings.localLatencyTargetMs, apiLatencyTargetMs: s.settings.apiLatencyTargetMs, ttsProvider: s.settings.ttsProvider, ttsModel: s.settings.ttsModel, ttsVoice: s.settings.ttsVoice }, emotion: emo, lang: s.settings.language,
        onStart: () => { setTalking(true); if (reqStart) setLatency((l) => ({ ...(l ?? {}), firstAudio: Math.round(performance.now() - reqStart) })); },
        onEnd: () => setTalking(false), onMouth: setMouth,
        onProvider: (p) => { setLastTtsProvider(p); if (p !== "browser") setTtsFallbackReason(""); },
        onFallbackReason: setTtsFallbackReason,
      });
      speakingRef.current = false;
      setTalking(false);
      setMouth({ level: 0, viseme: "closed" });
      // The voice session owns restarts; completing TTS must never re-enable a stopped mic.
    },
    [voiceOn],
  );

  const setModelSlot = useCallback(async (slot: "thinking" | "chat" | "audio", value: string) => {
    if (!stateRef.current) return;
    const selected = (models[slot] ?? []).find((m) => m.id === value);
    if (!selected) return;
    const patch = slot === "thinking"
      ? { thinkingModelMode: "selected", thinkingProvider: selected.provider, thinkingModel: selected.model }
      : slot === "chat"
        ? { chatModelMode: "selected", chatProvider: selected.provider, chatModel: selected.model }
        : { ttsProvider: "openrouter-fish", ttsModel: selected.model };
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setState((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);
  }, [models]);

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
      setMsgs((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: `🖼️ ${file.name} ��� ${question}` }]);
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
      if (!t) return;
      // Interrupts must be handled before the busy guard.
      if (/^(stop|cancel|quiet|shush|shut up|be quiet|enough)\b/i.test(t)) {
        stopSpeaking();
        speakingRef.current = false;
        setTalking(false);
        setMouth({ level: 0, viseme: "closed" });
        chatAbortRef.current?.abort();
        setStatus("");
        return;
      }
      if (busyRef.current) return;
      const hidden = opts?.hidden ?? false;
      stopSpeaking();
      setTalking(false);
      setMouth({ level: 0, viseme: "closed" });
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
      const responseGeneration = ++responseGenerationRef.current;
      chatAbortRef.current = ctl;
      // Latency instrumentation (real perf-clock timestamps for the debug panel).
      const reqStart = performance.now();
      const sttFinal = speechEndRef.current ? Math.round(reqStart - speechEndRef.current) : undefined;
      let firstTokenAt = 0;
      speechEndRef.current = 0; // consume it
      setLatency({ sttFinal });
      try {
        const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t, conversationId: convRef.current, selectedProvider: stateRef.current?.settings.thinkingModelMode === "selected" ? stateRef.current.settings.thinkingProvider : null, selectedModel: stateRef.current?.settings.thinkingModelMode === "selected" ? stateRef.current.settings.thinkingModel : null }), signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error(`Chat is unavailable (${res.status}). Please try again.`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const p of parts) {
            if (responseGeneration !== responseGenerationRef.current || ctl.signal.aborted) return;
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
              pushToast("quota", ev.message);
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
        setMsgs((messages) => messages.map((message) => message.id === pendingId && message.pending
          ? { ...message, pending: false, content: message.content || (ctl.signal.aborted ? "Response stopped." : "The connection ended before a reply arrived. Please try again."), emotion: "neutral" }
          : message));
        setBusy(false);
        busyRef.current = false;
        chatAbortRef.current = null;
        setStatus("");
        setAgentStep(null);
        setAgentTool(null);
      }
      if (!ctl.signal.aborted) for (const q of queued) await runAction(q.id, q.action);
    },
    [load, pushToast, runAction, runRoutine, say, switchCharacter],
  );
  sendRef.current = send;


  const { voice, micLevel, tone, startListening, stopListening } = useVoiceSession({
    phrase: state?.settings.wakeWord || "nova",
    language: state?.settings.language || "auto",
      onCommand: (command) => {
        if (Date.now() < voiceCaptureMuteUntilRef.current) return;
        const normalized = correctTranscript(command).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const spoken = lastSpokenRef.current;
        if (spoken && normalized.length >= 8 && (spoken.includes(normalized) || normalized.includes(spoken))) {
          lastSpokenRef.current = "";
          return;
        }
        speechEndRef.current = performance.now();
        void sendRef.current?.(correctTranscript(command));
      },
    onInterrupt: () => {
      responseGenerationRef.current += 1;
      chatAbortRef.current?.abort();
      stopSpeaking();
      speakingRef.current = false;
      setTalking(false);
      setMouth({ level: 0, viseme: "closed" });
      chatAbortRef.current?.abort();
    },
    isOccupied: () => speakingRef.current || busyRef.current,
  });
  const listening = voice.phase === "wake-listening" || voice.phase === "capturing";
  const voiceActive = !["idle", "stopped", "error"].includes(voice.phase);
  const wakeArmed = voiceActive && voice.mode === "wake";
  const autoListen = voiceActive && voice.mode === "auto";
  const interim = voice.command;

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
    <div className="command-room">
      <header className="command-header">
        <div className="flex items-center gap-3"><span className="wordmark">JARVISH<span className="text-primary">.</span></span><span className="header-divider" /><span className="text-sm text-muted-foreground">Your personal companion</span></div>
        <Link href="/settings" className="connection-pill"><span className="status-dot" />{state.online ? "Cloud configured" : "Local mode"}<SlidersHorizontal size={15} /></Link>
      </header>
      {/* LEFT: Character HUD */}
      <section className="panel character-panel">
        <div className="relative">
          <div className="flex items-start justify-between">
            <div>
              <div className="eyebrow">A LITTLE MORE HUMAN</div>
              <h1 className="character-name text-balance">Meet {c.name}<span className="text-primary">.</span></h1>
              <p className="text-sm text-muted-foreground">A familiar voice. A mind of possibilities.</p>
            </div>
            <button className="icon-button" aria-label="Switch character" aria-expanded={showChars} onClick={() => setShowChars((v) => !v)}><ChevronDown size={18} /></button>
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

          <CompanionStage emotion={charEmotion} state={charState} talking={talking} listening={listening} mouth={mouth} lipSync={state.settings.lipSyncEnabled !== false} browserVoice={lastTtsProvider === "browser"} />

          <div className="voice-state flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className={`chip ${charState === "error" ? "text-rose-300" : charState === "success" ? "text-emerald-300" : charState === "idle" ? "" : "text-cyan-300"}`}>{stateHud.text}</span>
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
            onClick={() => autoListen ? stopListening() : startListening("auto")}
            title="Hands-free: JARVIS listens, detects end of speech, and replies automatically"
          >
            <AudioLines size={19} /> {autoListen ? "End voice session" : "Start a conversation"} <span className="ml-auto"><ArrowUpRight size={18} /></span>
          </button>

          {/* Voice controls */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              className={`btn ${listening && !wakeArmed ? "btn-primary" : "btn-ghost"}`}
              onClick={() => (voiceActive && voice.mode === "once" ? stopListening() : startListening("once"))}
              disabled={busy || autoListen}
              title="Push to talk"
            >
              <Mic size={16} /> {voiceActive && voice.mode === "once" ? "Stop mic" : "Talk"}
            </button>
            <button className={`btn ${wakeArmed ? "btn-primary" : "btn-ghost"}`} onClick={() => (wakeArmed ? stopListening() : startListening("wake"))} title="Listen for the full wake phrase while this page is open">
              <Radio size={16} /> {wakeArmed ? "Stop wake" : "Wake"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setVoiceOn((v) => !v); stopSpeaking(); setTalking(false); setMouth({ level: 0, viseme: "closed" }); chatAbortRef.current?.abort(); }}>
              {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />} {voiceOn ? "Voice" : "Muted"}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            {autoListen
              ? "Listening hands-free. Say “stop” or your wake word to interrupt."
              : <>Enable Wake, then say <span className="text-primary">“{state.settings.wakeWord}”</span>. Your microphone stays off until enabled.</>}
          </p>

          <VoiceDiagnostics voice={voice} phrase={state.settings.wakeWord || "nova"} language={state.settings.language} stop={stopListening} retry={() => startListening("wake")} pushToTalk={() => startListening("once")} />
          <details className="engine-details"><summary>Under the hood <SlidersHorizontal size={14} /></summary>
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
                {state.online ? `Auto-routes each message: quick chat → fast model, hard tasks → smart model.` : "No API key yet ��� running the built-in offline persona engine. Add a free Groq key in Settings for the full brain."}
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
          </details>
        </div>
      </section>

      {/* RIGHT: Chat */}
      <section className="panel conversation-panel">
        <div className="conversation-header relative">
          <div className="flex items-center gap-2"><span className="status-dot" /><span className="text-sm font-medium">Conversation</span><span className="text-sm text-muted-foreground">/ {c.name}</span></div>
          <div className="flex items-center gap-3">
            <button className="text-xs text-slate-400 hover:text-white" onClick={() => setShowModelPicker((open) => !open)}><SlidersHorizontal size={14} className="mr-1 inline" />Models</button>
            <button className="text-xs text-slate-400 hover:text-white" onClick={() => { convRef.current = null; window.localStorage.removeItem("convId"); setMsgs([{ id: "greet", role: "assistant", content: state.greeting, emotion: c.defaultMood as AvatarEmotion, characterName: c.name }]); }}><Plus size={15} className="inline" /> New</button>
          </div>
          {showModelPicker && <div className="absolute right-3 top-12 z-20 w-[min(23rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">Active model slots</div>
            {(["thinking", "chat", "audio"] as const).map((slot) => {
              const options = models[slot];
              const current = slot === "thinking" ? `${state.settings.thinkingProvider ?? ""}/${state.settings.thinkingModel ?? ""}` : slot === "chat" ? `${state.settings.chatProvider ?? ""}/${state.settings.chatModel ?? ""}` : `${state.settings.ttsProvider === "openrouter-fish" ? "openrouter" : state.settings.ttsProvider}/${state.settings.ttsModel}`;
              return <label key={slot} className="mb-2 block text-xs text-slate-300"><span className="mb-1 block capitalize">{slot} {slot === "audio" ? "(Fish Audio stays here)" : ""}</span><select className="input !py-1.5 text-xs" value={current} onChange={(e) => setModelSlot(slot, e.target.value)}><option value={current}>{current === "/" || current.endsWith("/") ? "Auto routing" : current}</option>{options.filter((m) => m.configured).map((m) => <option key={m.id} value={m.id}>{m.label} · {m.tier}</option>)}</select></label>;
            })}
            <p className="mt-1 text-[10px] text-slate-500">Thinking and chat only show text-capable models. Audio models never answer messages.</p>
          </div>}
        </div>

        <div ref={listRef} className="conversation-messages" role="log" aria-label="Conversation messages" aria-live="polite">
          {msgs.length <= 1 && <div className="conversation-welcome"><div className="welcome-symbol"><AudioLines size={28} strokeWidth={1.3} /></div><p className="eyebrow">YOUR SPACE TO THINK OUT LOUD</p><h2 className="text-balance">Big ideas.<br />Everyday things.<br /><span className="text-muted-foreground">I&apos;m here for all of it.</span></h2></div>}
          {msgs.map((m) => (
            <div key={m.id} className={`anim-fade-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`message-bubble ${m.role === "user" ? "message-user" : "message-assistant"}`}>
                {m.role === "assistant" && <div className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>{m.characterName ?? c.name}{m.emotion ? ` · ${m.emotion}` : ""}</div>}
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
          <details className="mt-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.04]" open={activityOpen} onToggle={(event) => setActivityOpen(event.currentTarget.open)}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[10px] uppercase tracking-[0.2em] text-violet-300/80 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><ChevronDown size={13} className={`transition-transform ${activityOpen ? "rotate-180" : ""}`} /> Agent activity</span>
              <span className="text-slate-500">{agentLog.filter((a) => a.status === "done").length}/{agentLog.length}</span>
            </summary>
            <ul className="space-y-1 border-t border-violet-400/10 px-3 py-2.5">
              {agentLog.map((a) => (
                <li key={a.id} className="anim-fade-up flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 ${a.status === "failed" ? "text-rose-300" : a.status === "running" ? "text-cyan-300 animate-pulse" : "text-emerald-300"}`}>{a.icon}</span>
                  <div className="min-w-0 flex-1"><span className="font-mono text-[11px] text-slate-200">{a.text}</span>{a.detail && <p className={`break-words ${a.status === "failed" ? "text-rose-300/80" : "text-slate-400"}`}>{a.detail}</p>}</div>
                </li>
              ))}
            </ul>
          </details>
        )}

        <ActionTimeline actions={actions} onRetry={retryAction} onDismiss={(id) => setActions((a) => a.filter((x) => x.id !== id))} />

        <div className="quick-suggestions">
          {QUICK.map((q) => (
            <button key={q.label} onClick={() => send(q.text)} disabled={busy}>{q.label}<ArrowUpRight size={14} /></button>
          ))}
        </div>

        <form
          className="message-composer"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input className="composer-input" aria-label="Message your companion" placeholder={`Ask ${c.name} anything…`} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault(); }} disabled={busy} />
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.docx,.txt,.csv,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePicked(f); e.target.value = ""; }} />
          <div className="composer-tools"><div className="flex items-center gap-1">
          <button type="button" className="icon-button" aria-label="Attach image or document" onClick={() => fileInputRef.current?.click()} disabled={busy}><Paperclip size={18} /></button>
          <button type="button" className={`icon-button ${listening ? "text-primary" : ""}`} aria-label={listening ? "Stop microphone" : "Start microphone"} onClick={() => (listening ? stopListening() : startListening("once"))}><Mic size={18} /></button>
          <span className="text-sm text-muted-foreground">English · తెలుగు · हिन्दी</span></div>
          {busy || talking ? <button type="button" className="send-button" aria-label="Stop response" onClick={() => { chatAbortRef.current?.abort(); stopSpeaking(); speakingRef.current = false; setTalking(false); setMouth({ level: 0, viseme: "closed" }); }}><Square size={16} /></button> : <button type="submit" className="send-button" aria-label="Send message" disabled={!input.trim()}><ArrowUp size={19} /></button>}
          </div>
        </form>
        <p className="composer-note">You&apos;re in control. Actions that need permission ask first.</p>
      </section>

      {/* Toasts (proactive notifications) */}
      <div aria-live="polite" className="pointer-events-none fixed right-3 top-3 z-50 flex max-h-[30vh] w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-1.5 overflow-hidden">
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
