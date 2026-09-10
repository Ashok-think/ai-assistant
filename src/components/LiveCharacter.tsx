"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CharacterAvatar, { type AvatarEmotion } from "./CharacterAvatar";
import VideoCharacter from "./VideoCharacter";
import Live2DCharacter, { type Live2DHandle } from "./Live2DCharacter";
import { audioForEmotion } from "@/lib/character-assets";
import { speak, stopSpeaking, type MouthFrame } from "@/lib/voice-client";

/**
 * LIVE AI CHARACTER — the control center for the user's own anime character.
 *
 * Shows the character live (video emotion clips OR the true audio-lip-sync avatar), with real
 * controls: use-as-JARVIS, preview the character's own recorded voice, test the TTS master voice,
 * test lip-sync, emotion selector, intensity, lip-sync toggle, render mode. Every "speaking" here
 * is real audio driving the mouth; interruption stops audio + lip-sync and returns to LISTENING.
 */

type Settings = {
  masterVoiceEnabled: boolean; masterGeminiVoice: string; masterElevenVoiceId: string | null;
  voiceSpeed: number; emotionIntensity: number; customVoiceStatus: string; renderMode: string;
  lipSyncEnabled: boolean; ttsProvider: string; voiceEnabled: boolean;
};

const EMOTIONS: AvatarEmotion[] = ["neutral", "happy", "excited", "sad", "angry", "shy", "sleepy", "thinking"];
const EMOTION_LINES: Record<string, string> = {
  neutral: "Hi, I'm here and ready whenever you are.",
  happy: "Yay! I'm so glad you're here with me today.",
  excited: "Ooh this is exciting — let's do something amazing!",
  sad: "It's okay to have quiet days. I'm right here with you.",
  angry: "Alright, that's enough — let's fix this properly.",
  shy: "Oh… um… it's really nice to talk with you.",
  sleepy: "Mmm… it's getting late… I'm still listening though.",
  thinking: "Hmm, let me think about that for a second.",
};

export default function LiveCharacter() {
  const [s, setS] = useState<Settings | null>(null);
  const [emotion, setEmotion] = useState<AvatarEmotion>("happy");
  const [talking, setTalking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [mouth, setMouth] = useState<MouthFrame>({ level: 0, viseme: "closed" });
  const [status, setStatus] = useState("");
  const [isActive, setIsActive] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  // Live2D auto-detection: does a real rigged model exist? And is the renderer ready?
  const [live2d, setLive2d] = useState<{ present: boolean; modelUrl: string | null; message: string } | null>(null);
  const [rigStatus, setRigStatus] = useState<"init" | "loading" | "ready" | "no-core" | "error">("init");
  const [rigDetail, setRigDetail] = useState("");
  const live2dRef = useRef<Live2DHandle | null>(null);
  // AI video lip-sync backend (remote GPU) — honest status, never fakes generation.
  const [backend, setBackend] = useState<{ provider: string; state: string; detail: string; canGenerate: boolean } | null>(null);
  const [genStatus, setGenStatus] = useState("");
  const [genVideoUrl, setGenVideoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, l2d] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/character/live2d-status").then((r) => r.json()).catch(() => ({ present: false, modelUrl: null, message: "detection failed" })),
    ]);
    setS(st);
    setLive2d(l2d);
    setIsActive(Boolean(st.masterVoiceEnabled));
    fetch("/api/talking-character/backend-status").then((r) => r.json()).then(setBackend).catch(() => setBackend(null));
  }, []);

  // Dev/test: construct + send a REAL talking-video request. Honest — reports the backend's
  // actual response, and never plays the source MP4 as a substitute.
  const testGenerate = useCallback(async () => {
    setGenVideoUrl(null);
    if (!backend?.canGenerate) {
      setGenStatus(`AI Video Lip-Sync unavailable — ${backend?.detail ?? "configure a GPU backend"}`);
      return;
    }
    setGenStatus("Building request (source clip + master TTS audio + emotion)…");
    try {
      const fd = new FormData();
      fd.append("source_video_url", "/character/neutral.mp4");
      fd.append("emotion", emotion);
      fd.append("intensity", String(s?.emotionIntensity ?? 1));
      fd.append("text", "Hello, I'm your AI assistant. How can I help you today?");
      const r = await fetch("/api/talking-character/create", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) { setGenStatus(`Backend error: ${j.error}`); return; }
      setGenStatus(`Job ${j.jobId} (${j.status}) — polling…`);
      // Poll status → result.
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const sres = await fetch(`/api/talking-character/status/${j.jobId}`).then((x) => x.json());
        if (!sres.ok) { setGenStatus(`status error: ${sres.error}`); return; }
        setGenStatus(`Job ${j.jobId}: ${sres.status}${sres.progress != null ? ` ${Math.round(sres.progress * 100)}%` : ""}`);
        if (sres.status === "succeeded") {
          const rr = await fetch(`/api/talking-character/result/${j.jobId}`).then((x) => x.json());
          if (rr.ok) { setGenVideoUrl(rr.videoUrl); setGenStatus("Generated talking video ready."); } else setGenStatus(`result error: ${rr.error}`);
          return;
        }
        if (sres.status === "failed" || sres.status === "canceled") { setGenStatus(`Job ${sres.status}.`); return; }
      }
      setGenStatus("Timed out waiting for the backend.");
    } catch (e) {
      setGenStatus(`Request failed: ${(e as Error).message}`);
    }
  }, [backend, emotion, s]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (p: Partial<Settings>) => {
    setS((cur) => (cur ? { ...cur, ...p } : cur));
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  }, []);

  const state: "idle" | "listening" | "thinking" | "speaking" = talking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";

  // The LIVE renderer is ONLY the rigged Live2D avatar (when present+ready) or the procedural
  // avatar fallback. The prerecorded MP4 is NEVER the live renderer — it's an optional preview
  // shown on demand via a separate button, and never during conversation.
  const live2dUsable = Boolean(live2d?.present && live2d.modelUrl) && rigStatus === "ready";
  const renderer: "live2d" | "avatar" = live2dUsable ? "live2d" : "avatar";
  const [showClipPreview, setShowClipPreview] = useState(false);

  // Load the detected model once the renderer signals ready.
  useEffect(() => {
    if (rigStatus === "ready" && live2d?.present && live2d.modelUrl && live2dRef.current) {
      live2dRef.current.loadModel(live2d.modelUrl).catch(() => {});
    }
  }, [rigStatus, live2d?.present, live2d?.modelUrl]);

  // Forward live state/emotion/mouth to the Live2D rig whenever they change.
  useEffect(() => { live2dRef.current?.setState(state); }, [state]);
  useEffect(() => { live2dRef.current?.setEmotion(thinking ? "thinking" : emotion); }, [emotion, thinking]);
  useEffect(() => { if (s) { live2dRef.current?.setEmotionIntensity(s.emotionIntensity); live2dRef.current?.setLipSync(s.lipSyncEnabled); } }, [s]);
  useEffect(() => { live2dRef.current?.setMouth(mouth); }, [mouth]);

  // Hard stop — used by interrupt and on unmount.
  const stopAll = useCallback(() => {
    stopSpeaking();
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    setTalking(false); setThinking(false);
    setMouth({ level: 0, viseme: "closed" });
  }, []);
  useEffect(() => () => stopAll(), [stopAll]);

  /** Preview the character's OWN recorded voice (the extracted mp3), lip-syncing to it. */
  const previewVoice = useCallback(async () => {
    stopAll();
    const url = audioForEmotion(emotion);
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const audio = new Audio(url);
      audio.crossOrigin = "anonymous";
      previewAudioRef.current = audio;
      const srcNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      srcNode.connect(analyser); analyser.connect(ctx.destination);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const bins = buf.length; let sum = 0, low = 0, high = 0; const mid = Math.floor(bins / 3);
        for (let i = 0; i < bins; i++) { sum += buf[i]; if (i < mid) low += buf[i]; else if (i > mid * 2) high += buf[i]; }
        const level = Math.min(1, sum / bins / 255 * 3);
        const viseme = level < 0.08 ? "closed" : high > low * 1.15 ? "wide" : low > high * 1.6 ? "round" : "mid";
        setMouth({ level, viseme });
        raf = requestAnimationFrame(tick);
      };
      audio.onplay = () => { setTalking(true); tick(); };
      audio.onended = () => { cancelAnimationFrame(raf); setTalking(false); setMouth({ level: 0, viseme: "closed" }); ctx.close(); };
      setStatus("Playing the character's own recorded voice…");
      await audio.play();
    } catch (e) {
      setStatus(`Preview failed: ${(e as Error).message}`);
    }
  }, [emotion, stopAll]);

  /** Test the MASTER TTS voice. Reports the REAL provider; if none, says so (no fake "custom voice"). */
  const testVoice = useCallback(async () => {
    stopAll();
    setShowClipPreview(false);
    if (!s?.voiceEnabled) { setStatus("Voice replies are muted in Settings."); return; }
    setThinking(true);
    setStatus("Requesting the configured TTS provider…");
    const line = EMOTION_LINES[emotion] ?? EMOTION_LINES.neutral;
    let provider = "";
    await speak(line, {
      voice: { pitch: 1, rate: 1, warmth: 60 },
      emotion,
      onProvider: (p) => { provider = p; },
      onStart: () => { setThinking(false); setTalking(true); },
      onEnd: () => { setTalking(false); setMouth({ level: 0, viseme: "closed" }); },
      onMouth: setMouth,
    });
    setThinking(false);
    if (!provider) {
      setStatus("CUSTOM MASTER VOICE: unavailable · no Gemini/ElevenLabs key returned audio. Add a key in Settings.");
    } else if (provider === "browser") {
      setStatus("CUSTOM MASTER VOICE: unavailable → BROWSER TTS FALLBACK (labeled). Add a Gemini/ElevenLabs key for the real master voice.");
    } else {
      const label = s.customVoiceStatus === "active" ? "your custom character voice" : "preset master voice (not your character's voice yet)";
      setStatus(`Speaking via ${provider} — ${label}, ${emotion} delivery.`);
    }
  }, [emotion, s, stopAll]);

  /**
   * Test Lip-Sync: drive the LIVE avatar mouth from REAL audio. Never plays the MP4.
   * Prefers the master TTS; if no provider, falls back to the character's recorded voice clip
   * (still real audio, clearly labeled) so you can still see the mouth track amplitude.
   */
  const testLipSync = useCallback(async () => {
    stopAll();
    setShowClipPreview(false);
    if (s?.voiceEnabled) {
      let provider = "";
      await speak("Watch the avatar's mouth move with these exact words.", {
        voice: { pitch: 1, rate: 1, warmth: 60 }, emotion,
        onProvider: (p) => { provider = p; },
        onStart: () => setTalking(true),
        onEnd: () => { setTalking(false); setMouth({ level: 0, viseme: "closed" }); },
        onMouth: setMouth,
      });
      if (provider && provider !== "browser") { setStatus(`LIVE AVATAR · REAL AUDIO LIP-SYNC (via ${provider}).`); return; }
    }
    // Fallback: use the real recorded character clip audio to drive the mouth.
    setStatus("LIVE AVATAR · REAL AUDIO LIP-SYNC (from recorded character clip — no TTS provider).");
    previewVoice();
  }, [emotion, s, stopAll, previewVoice]);

  // Simulate the LISTENING / THINKING states so the user can see them (real state, not a fake clip).
  const demoListen = useCallback(() => { stopAll(); setListening(true); setStatus("LISTENING — mic-open state"); setTimeout(() => setListening(false), 2500); }, [stopAll]);
  const demoThink = useCallback(() => { stopAll(); setThinking(true); setStatus("THINKING — processing state"); setTimeout(() => setThinking(false), 2500); }, [stopAll]);

  if (!s) return <div className="panel p-5 text-sm text-slate-400">Loading Live AI Character…</div>;

  const voiceStatusLabel =
    s.customVoiceStatus === "active" ? { text: "Custom character voice: ACTIVE", cls: "text-emerald-300" }
      : s.customVoiceStatus === "reference_ready" ? { text: "Voice reference: READY · custom voice NOT active", cls: "text-amber-300" }
        : { text: `Preset fallback voice (${s.masterElevenVoiceId ? "ElevenLabs" : s.masterGeminiVoice}) · not your character's voice`, cls: "text-amber-300" };

  return (
    <section className="panel relative overflow-hidden p-5">
      <div className="hud-grid absolute inset-0 opacity-60" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-300/80">Live AI Character</div>
            <h2 className="mt-1 text-2xl font-semibold text-white">Your Talking Character</h2>
            <p className="text-xs text-slate-400">Your own anime character with one consistent master voice. Emotion changes delivery, not identity.</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`chip ${voiceStatusLabel.cls}`}>🎙 {voiceStatusLabel.text}</span>
            <span className="chip">state: {state}</span>
          </div>
        </div>

        {/* Renderer status chips — every claim here reflects real detection, nothing faked. */}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          <span className={`chip ${renderer === "live2d" ? "text-emerald-300" : "text-amber-300"}`}>
            {renderer === "live2d" ? "✓ LIVE ANIME AVATAR" : "LIVE ANIME AVATAR · rig required"}
          </span>
          <span className={`chip ${s.lipSyncEnabled ? "text-cyan-300" : ""}`}>✓ REAL-TIME LIP-SYNC{s.lipSyncEnabled ? "" : " (off)"}</span>
          <span className={`chip ${s.customVoiceStatus === "active" ? "text-emerald-300" : "text-amber-300"}`}>{s.customVoiceStatus === "active" ? "✓ MASTER VOICE" : "MASTER VOICE · preset"}</span>
          <span className="chip text-cyan-300">✓ EMOTION ENGINE</span>
          <span className="chip">renderer: {renderer === "live2d" ? "live avatar" : "live avatar / rig required → procedural fallback"}</span>
          <span className={`chip ${backend?.state === "available" ? "text-emerald-300" : backend?.state === "ready" || backend?.state === "processing" ? "text-cyan-300" : backend?.state === "error" ? "text-rose-300" : "text-amber-300"}`}>
            AI lip-sync backend: {backend ? backend.state : "…"}
          </span>
        </div>

        {/* Honest rig-required / fallback banner */}
        {!live2d?.present ? (
          <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-2.5 text-[11px] text-amber-200/90">
            <b>Live anime character: Character rig required.</b> No Live2D model found. Place a rigged model at
            <code className="mx-1 rounded bg-black/40 px-1">public/character/live2d/&lt;name&gt;.model3.json</code>
            (+ .moc3, textures/, physics3.json) and it auto-loads. See <code className="rounded bg-black/40 px-1">public/character/live2d/README.md</code>.
            <div className="mt-1 text-slate-400">Procedural Avatar: <span className="text-emerald-300">Available fallback</span> (real audio lip-sync, shown now).</div>
          </div>
        ) : rigStatus === "no-core" ? (
          <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-2.5 text-[11px] text-amber-200/90">
            <b>Model found, but Live2D Cubism Core is missing.</b> Add <code className="rounded bg-black/40 px-1">public/live2dcubismcore.min.js</code> (free from Live2D). Using procedural fallback until then.
          </div>
        ) : rigStatus === "error" ? (
          <div className="mt-2 rounded-xl border border-rose-400/30 bg-rose-400/[0.06] p-2.5 text-[11px] text-rose-200/90">Live2D load error: {rigDetail}. Using procedural fallback.</div>
        ) : null}

        <div className="mt-4 grid gap-5 lg:grid-cols-[320px_1fr]">
          {/* Live preview */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {/* Optional emotion-clip PREVIEW (explicit, on demand only) — never the live renderer. */}
              {showClipPreview ? (
                <div className="relative">
                  <VideoCharacter emotion={emotion} talking={true} listening={false} size={300} accent="#22d3ee" />
                  <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-amber-200">reference clip preview (not live)</div>
                </div>
              ) : (
                <>
                  {/* Live2D is mounted whenever a model is present so it can report readiness; shown when it's the active renderer. */}
                  {live2d?.present && (
                    <div style={{ display: renderer === "live2d" ? "block" : "none" }}>
                      <Live2DCharacter ref={live2dRef} size={300} onStatus={(st, d) => { setRigStatus(st); if (d) setRigDetail(d); }} />
                    </div>
                  )}
                  {renderer === "avatar" && (
                    <CharacterAvatar color="#a855f7" accent="#22d3ee" emoji="🌸" emotion={thinking ? "thinking" : emotion} talking={talking} listening={listening} size={300} mouthLevel={s.lipSyncEnabled ? mouth.level : 0} viseme={mouth.viseme} />
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button className={`btn ${isActive ? "btn-primary" : "btn-ghost"} !py-1.5 text-xs`} onClick={() => { patch({ masterVoiceEnabled: true }); setIsActive(true); setStatus("This character + master voice is now your JARVIS voice."); }}>
                {isActive ? "✓ Active JARVIS voice" : "Use as JARVIS"}
              </button>
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={previewVoice}>🔊 Preview character voice</button>
            </div>
            {status && <p className="text-center text-xs text-cyan-200/90">{status}</p>}
          </div>

          {/* Controls */}
          <div className="grid gap-3">
            <div>
              <label className="label">Emotion</label>
              <div className="flex flex-wrap gap-1.5">
                {EMOTIONS.map((e) => (
                  <button key={e} className={`chip ${emotion === e ? "bg-white/15 text-cyan-200" : "hover:bg-white/10"}`} onClick={() => setEmotion(e)}>{e}</button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label flex justify-between"><span>Emotion intensity</span><span>{Math.round(s.emotionIntensity * 100)}%</span></label>
                <input type="range" min={0} max={1.5} step={0.1} className="w-full accent-violet-500" value={s.emotionIntensity} onChange={(e) => patch({ emotionIntensity: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label flex justify-between"><span>Speaking speed</span><span>{s.voiceSpeed.toFixed(2)}×</span></label>
                <input type="range" min={0.7} max={1.2} step={0.05} className="w-full accent-cyan-400" value={s.voiceSpeed} onChange={(e) => patch({ voiceSpeed: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Render mode (live)</label>
                <div className="input flex items-center justify-between !cursor-default">
                  <span>{renderer === "live2d" ? "LIVE ANIME AVATAR — real-time" : "LIVE AVATAR · rig required → procedural fallback"}</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">The live renderer is the rigged avatar (or procedural fallback). Your MP4s are never played during conversation.</p>
              </div>
              <div className="flex items-end gap-2">
                <button className={`btn ${s.lipSyncEnabled ? "btn-primary" : "btn-ghost"} flex-1 !py-1.5 text-xs`} onClick={() => patch({ lipSyncEnabled: !s.lipSyncEnabled })}>
                  👄 Lip-sync {s.lipSyncEnabled ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn btn-primary !py-1.5 text-xs" onClick={testVoice}>🗣️ Test Voice (master TTS)</button>
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={testLipSync}>👄 Test Lip-Sync</button>
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={demoListen}>🎧 Listening</button>
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={demoThink}>🧠 Thinking</button>
              <button className={`btn ${showClipPreview ? "btn-primary" : "btn-ghost"} !py-1.5 text-xs`} onClick={() => { stopAll(); setShowClipPreview((v) => !v); setStatus(showClipPreview ? "" : "Showing your reference MP4 clip (not the live renderer)."); }}>🎞️ {showClipPreview ? "Hide clip" : "Preview emotion clip"}</button>
              {talking && <button className="btn !py-1.5 text-xs text-rose-300" onClick={() => { stopAll(); setListening(true); setStatus("Interrupted → LISTENING"); setTimeout(() => setListening(false), 1500); }}>⏹ Interrupt</button>}
            </div>

            {/* AI VIDEO LIP-SYNC BACKEND — remote GPU, honest status, dev test request. */}
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200">AI Video Lip-Sync (remote GPU)</div>
                <span className={`chip ${backend?.canGenerate ? "text-emerald-300" : "text-amber-300"}`}>
                  {backend?.state === "not-configured" ? "Not configured" : backend?.state === "ready" ? "Remote GPU ready" : backend?.state === "available" ? "Available" : backend?.state === "processing" ? "Processing" : backend?.state === "error" ? "Error" : "…"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{backend?.detail ?? "Checking backend…"}</p>
              {!backend?.canGenerate ? (
                <p className="mt-2 text-[11px] text-amber-300">AI Video Lip-Sync unavailable — configure a GPU backend (<code className="rounded bg-black/40 px-1">TALKING_CHARACTER_PROVIDER=remote</code> + <code className="rounded bg-black/40 px-1">REMOTE_LIPSYNC_URL</code>). We do <b>not</b> play the source MP4 as a substitute.</p>
              ) : (
                <button className="btn btn-primary mt-2 !py-1.5 text-xs" onClick={testGenerate}>🎬 Test generate talking video</button>
              )}
              {genStatus && <p className="mt-2 text-[11px] text-cyan-200">{genStatus}</p>}
              {genVideoUrl && (
                <video className="mt-2 w-full max-w-[300px] rounded-lg border border-white/10" src={genVideoUrl} controls playsInline />
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              During conversation the character is the <b>live avatar</b> (rigged Live2D when you add one, otherwise the procedural fallback) driven by the real TTS audio — your MP4s are <b>never</b> played as the talker. They&apos;re only shown when you press &quot;Preview emotion clip&quot;. Add a Live2D rig (see <code className="rounded bg-black/40 px-1">public/character/live2d/README.md</code>) to make it your actual anime girl, and a Gemini/ElevenLabs key (or clone) in <a className="text-cyan-300 underline" href="/settings">Settings</a> for the real master voice.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
