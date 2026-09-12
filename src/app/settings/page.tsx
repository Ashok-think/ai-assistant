"use client";

import { useCallback, useEffect, useState } from "react";

type Settings = {
  assistantName: string; wakeWord: string; userName: string; language: string; freeOnlyMode: boolean; safeMode: boolean; lowPowerMode: boolean;
  voiceEnabled: boolean; wakeWordEnabled: boolean; proactiveEnabled: boolean; dailyBudgetUsd: number; routerMode: string; ttsProvider: string; ttsModel: string; ttsVoice: string; chatModelMode: string; chatProvider: string | null; chatModel: string | null; thinkingModelMode: string; thinkingProvider: string | null; thinkingModel: string | null;
  masterVoiceEnabled: boolean; masterGeminiVoice: string; masterElevenVoiceId: string | null; voiceSpeed: number; emotionIntensity: number;
  customVoiceStatus: string; renderMode: string; lipSyncEnabled: boolean;
  openaiKey: string; groqKey: string; openrouterKey: string; elevenLabsKey: string; ollamaUrl: string | null;
  geminiKey: string;
  groqBaseUrl: string | null; groqFastModel: string | null; groqSmartModel: string | null;
  openaiBaseUrl: string | null; openaiFastModel: string | null; openaiSmartModel: string | null;
  openrouterBaseUrl: string | null; openrouterFastModel: string | null; openrouterSmartModel: string | null;
  geminiFastModel: string | null; geminiSmartModel: string | null; ollamaModel: string | null;
  tokenrouterKey: string; tokenrouterBaseUrl: string | null; tokenrouterModel: string | null;
  qwenKey: string; qwenBaseUrl: string | null; qwenModel: string | null;
  aihubKey: string; aihubBaseUrl: string | null; aihubModel: string | null;
  customKey: string; customBaseUrl: string | null; customModel: string | null;
  permissions: Record<string, boolean>;
  envKeys: Record<string, boolean>;
};
type ProviderHealth = { checkedAt: string; anyConfigured: boolean; results: { provider: string; tier: string; model: string; ok: boolean; status: number | string; latencyMs: number; detail?: string }[] };
type Usage = {
  today: number; budget: number;
  byTier: { tier: string; calls: number; tokensIn: number; tokensOut: number; cost: number; avgLatency: number }[];
  byModel: { provider: string; model: string; calls: number; cost: number }[];
  recent: { id: number; provider: string; model: string; tier: string; reason: string; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number; createdAt: string }[];
  providers: { tier: string; provider: string; model: string; free: boolean; inPer1M: number; outPer1M: number }[];
};

const PERMS = [
  { key: "mic", label: "Microphone", desc: "Voice input & wake word" },
  { key: "camera", label: "Camera", desc: "Vision mode / AR" },
  { key: "location", label: "Location", desc: "Local weather & suggestions" },
  { key: "notifications", label: "Notifications", desc: "Proactive reminders" },
  { key: "contacts", label: "Contacts", desc: "Calls & messages (mobile)" },
  { key: "screen", label: "Screen awareness", desc: "Reads on-screen content (mobile)" },
];

function ToggleControl({ label, desc, value, onToggle }: { label: string; desc: string; value: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <div><div className="text-sm text-slate-100">{label}</div><div className="text-xs text-slate-400">{desc}</div></div>
      <button onClick={onToggle} className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? "bg-gradient-to-r from-violet-500 to-cyan-400" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [saved, setSaved] = useState("");
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [voiceTest, setVoiceTest] = useState("");
  const [cloneStatus, setCloneStatus] = useState("");
  const [geminiVoices, setGeminiVoices] = useState<string[]>([]);
  const [elevenVoices, setElevenVoices] = useState<{ id: string; name: string }[]>([]);
  // ElevenLabs real diagnostic state.
  const [el11, setEl11] = useState<{ state: string; detail: string; voice?: string; tier?: string; used?: number; limit?: number } | null>(null);
  const [el11Testing, setEl11Testing] = useState(false);

  const load = useCallback(async () => {
    const [st, u, v] = await Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/usage").then((r) => r.json()),
      fetch("/api/tts/voices").then((r) => r.json()).catch(() => null),
    ]);
    setS(st);
    setUsage(u);
    if (v) {
      setGeminiVoices((v.gemini ?? []).map((x: { id: string }) => x.id));
      setElevenVoices(v.elevenlabs ?? []);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const patch = async (p: Partial<Settings>) => {
    if (!s) return;
    setS({ ...s, ...p });
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    setSaved("Saved ✔");
    setTimeout(() => setSaved(""), 1500);
    if ("openaiKey" in p || "groqKey" in p || "openrouterKey" in p || "ollamaUrl" in p || "freeOnlyMode" in p || "routerMode" in p || "dailyBudgetUsd" in p || "geminiKey" in p || "tokenrouterKey" in p || "qwenKey" in p || "aihubKey" in p || "customKey" in p) load();
  };

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const h = await fetch("/api/health/providers").then((r) => r.json());
      setHealth(h);
    } finally {
      setChecking(false);
    }
  }, []);

  // Play a short line through the server TTS and report which provider actually spoke.
  const testVoice = useCallback(async () => {
    setVoiceTest("Testing…");
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hi, this is a voice test. Can you hear me clearly?", emotion: "happy" }),
      });
      if (r.status === 204) {
        const attempts = r.headers.get("X-TTS-Attempts") ?? "[]";
        setVoiceTest(`No server voice available → browser will speak. Attempts: ${attempts}`);
        // Let the browser speak so the user still hears something.
        if (typeof window !== "undefined" && window.speechSynthesis) {
          const u = new SpeechSynthesisUtterance("Hi, this is a browser voice test.");
          window.speechSynthesis.speak(u);
        }
        return;
      }
      if (!r.ok) {
        setVoiceTest(`TTS error ${r.status}`);
        return;
      }
      const provider = r.headers.get("X-TTS-Provider") ?? "?";
      const voice = r.headers.get("X-TTS-Voice") ?? "?";
      const blob = await r.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play().catch(() => {});
      setVoiceTest(`✔ Spoke via ${provider} (voice ${voice})`);
    } catch (e) {
      setVoiceTest(`Failed: ${(e as Error).message}`);
    }
  }, []);

  // Upload a voice reference for the future custom voice. Honest: only becomes "active" if a
  // real ElevenLabs clone is created; otherwise it's "reference ready".
  const uploadVoiceReference = useCallback(async (file: File) => {
    setCloneStatus("Uploading reference…");
    try {
      const fd = new FormData();
      fd.append("audio", file);
      fd.append("name", "Jarvish Character Voice");
      const r = await fetch("/api/voice/clone", { method: "POST", body: fd });
      const j = (await r.json()) as { status?: string; active?: boolean; message?: string; error?: string };
      setCloneStatus(j.active ? `✔ ${j.message}` : `⚠ ${j.error ?? j.message ?? "reference saved, custom voice not active"}`);
      load();
    } catch (e) {
      setCloneStatus(`Failed: ${(e as Error).message}`);
    }
  }, [load]);

  // Test Lip-Sync: play a line and drive an on-page mouth from the actual audio amplitude.
  const [lipTest, setLipTest] = useState(0);
  const testLipSync = useCallback(async () => {
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Watch my mouth move with these exact words.", emotion: "happy" }) });
      if (r.status !== 200) { setVoiceTest("No server audio to lip-sync (add a voice key). Browser TTS has no waveform to analyze."); return; }
      const blob = await r.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const srcNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      srcNode.connect(analyser); analyser.connect(ctx.destination);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
        setLipTest(Math.min(1, avg * 3));
        raf = requestAnimationFrame(tick);
      };
      audio.onplay = () => tick();
      audio.onended = () => { cancelAnimationFrame(raf); setLipTest(0); ctx.close(); };
      await audio.play();
    } catch (e) {
      setVoiceTest(`Lip-sync test failed: ${(e as Error).message}`);
    }
  }, []);

  // Map the real diagnostic categories to clear UI states.
  const el11Label = (cat: string): string => {
    switch (cat) {
      case "authentication_failed": return "Authentication failed";
      case "forbidden_or_key_restricted": return "Key restricted / forbidden";
      case "voice_not_found": return "Voice not found";
      case "invalid_request_or_voice": return "Invalid request / voice";
      case "quota_or_rate_limit":
      case "quota_unavailable": return "Quota / rate limit";
      case "no_key": return "No key set";
      case "network_error": return "Network error";
      default: return cat;
    }
  };

  // Check auth + voice (GET) — cheap, safe.
  const checkEleven = useCallback(async () => {
    setEl11Testing(true);
    setEl11(null);
    try {
      const j = await fetch("/api/tts/test-elevenlabs").then((r) => r.json());
      if (j.connected) {
        setEl11({ state: j.voiceExists ? "Connected" : "Voice not found", detail: j.detail, voice: j.voiceName, tier: j.tier, used: j.charactersUsed, limit: j.characterLimit });
      } else {
        setEl11({ state: el11Label(j.category || "error"), detail: j.detail || "Not connected" });
      }
    } catch (e) {
      setEl11({ state: "Network error", detail: (e as Error).message });
    } finally {
      setEl11Testing(false);
    }
  }, []);

  // Real TTS test (POST) — must actually return audio to claim success.
  const testEleven = useCallback(async () => {
    setEl11Testing(true);
    try {
      const r = await fetch("/api/tts/test-elevenlabs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello, I am Rio." }) });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) {
        const voice = r.headers.get("X-Test-Voice"); const model = r.headers.get("X-Test-Model"); const latency = r.headers.get("X-Test-Latency"); const bytes = r.headers.get("X-Test-Bytes");
        const blob = await r.blob();
        await new Audio(URL.createObjectURL(blob)).play().catch(() => {});
        setEl11({ state: "Connected", detail: `✔ Real audio returned: ${bytes} bytes, voice ${voice}, model ${model}, ${latency}ms.` });
      } else {
        const j = await r.json().catch(() => ({}));
        setEl11({ state: el11Label(j.category || "error"), detail: j.detail || `HTTP ${r.status}`, voice: j.voiceId });
      }
    } catch (e) {
      setEl11({ state: "Network error", detail: (e as Error).message });
    } finally {
      setEl11Testing(false);
    }
  }, []);

  const requestPerm = async (key: string) => {
    let granted = false;
    try {
      if (key === "mic") { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); granted = true; }
      else if (key === "camera") { const st = await navigator.mediaDevices.getUserMedia({ video: true }); st.getTracks().forEach((t) => t.stop()); granted = true; }
      else if (key === "notifications") { granted = (await Notification.requestPermission()) === "granted"; }
      else if (key === "location") { granted = await new Promise<boolean>((res) => navigator.geolocation.getCurrentPosition(() => res(true), () => res(false))); }
      else granted = !s?.permissions[key];
    } catch { granted = false; }
    patch({ permissions: { ...(s?.permissions ?? {}), [key]: granted } });
  };

  if (!s) return <div className="p-10 text-slate-400">Loading settings…</div>;

  const pct = usage ? Math.min(100, (usage.today / Math.max(0.01, usage.budget)) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold text-white">⚙️ Settings</h1><p className="text-sm text-slate-400">Identity, voice, token router, keys, safety and cost control.</p></div>
        <span className="text-xs text-emerald-300">{saved}</span>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identity */}
        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">Identity</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Assistant name</label><input className="input" defaultValue={s.assistantName} onBlur={(e) => patch({ assistantName: e.target.value.trim() || "Rio" })} /></div>
            <div><label className="label" htmlFor="wake-phrase">Wake phrase</label><input id="wake-phrase" className="input" key={s.wakeWord} defaultValue={s.wakeWord} onBlur={(e) => patch({ wakeWord: e.target.value.trim() || "hey rio" })} /><p className="text-sm leading-relaxed text-muted-foreground">Click Wake on the home screen to enable the microphone. Keep the page open; browser recognition requires internet. Auto language uses English (India) for recognition, not automatic language switching.</p></div>
            <div><label className="label">Your name</label><input className="input" defaultValue={s.userName} onBlur={(e) => patch({ userName: e.target.value })} /></div>
            <div><label className="label">Language</label>
              <select className="input" value={s.language} onChange={(e) => patch({ language: e.target.value })}>
                <option value="auto">Auto-detect</option><option value="en">English</option><option value="en-IN">English (India)</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option><option value="te">Telugu (తెలుగు)</option><option value="tenglish">Telugu + English</option><option value="ja">Japanese (日本語)</option>
              </select>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ToggleControl label="Voice replies" desc="Speak answers aloud (Fish Audio → Gemini → ElevenLabs → browser)" value={s.voiceEnabled} onToggle={() => patch({ voiceEnabled: !s.voiceEnabled })} />
            <ToggleControl label="Proactive mode" desc="Check-ins, nudges, reminders" value={s.proactiveEnabled} onToggle={() => patch({ proactiveEnabled: !s.proactiveEnabled })} />
            <ToggleControl label="Safe / parental mode" desc="Family-friendly, no flirting" value={s.safeMode} onToggle={() => patch({ safeMode: !s.safeMode })} />
            <ToggleControl label="Low battery mode" desc="Disables heavy animations, prefers fast models" value={s.lowPowerMode} onToggle={() => patch({ lowPowerMode: !s.lowPowerMode })} />
          </div>
        </section>

        {/* Voice engine */}
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-slate-400">Voice engine</h2>
          <p className="mb-3 text-xs text-slate-500">Choose which text-to-speech engine speaks. Auto tries Fish Audio via OpenRouter, then Gemini, ElevenLabs, and finally the browser. Test it to see exactly which one returned playable audio.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">TTS engine</label>
              <select className="input" value={s.ttsProvider} onChange={(e) => patch({ ttsProvider: e.target.value })}>
                <option value="auto">Auto (Fish Audio → Gemini → ElevenLabs → browser)</option>
                <option value="openrouter-fish">Fish Audio via OpenRouter</option>
                <option value="gemini">Gemini TTS</option>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="browser">Browser speech (offline)</option>
              </select>
            </div>
            <div><label className="label">TTS model</label><input className="input" value={s.ttsModel} onChange={(e) => setS({ ...s, ttsModel: e.target.value })} onBlur={(e) => patch({ ttsModel: e.target.value.trim() || "fish-audio/s2.1-pro" })} placeholder="fish-audio/s2.1-pro" /></div>
            <div><label className="label">Fish Audio voice</label><input className="input" value={s.ttsVoice} onChange={(e) => setS({ ...s, ttsVoice: e.target.value })} onBlur={(e) => patch({ ttsVoice: e.target.value.trim() || "default" })} placeholder="default" /></div>
            <div className="flex items-end">
              <button className="btn btn-primary w-full" onClick={testVoice}>🔊 Test voice</button>
            </div>
          </div>
          {voiceTest && <p className="mt-2 text-xs text-cyan-200">{voiceTest}</p>}

          {/* ElevenLabs real diagnostic — no silent fallbacks, honest states. */}
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-200">ElevenLabs</div>
              <span className={`chip ${el11?.state === "Connected" ? "text-emerald-300" : el11 ? "text-rose-300" : "text-slate-400"}`}>
                {el11 ? el11.state : "not checked"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn btn-ghost !py-1 text-xs" onClick={checkEleven} disabled={el11Testing}>{el11Testing ? "Checking…" : "Check connection"}</button>
              <button className="btn btn-primary !py-1 text-xs" onClick={testEleven} disabled={el11Testing}>🔊 Test ElevenLabs (real audio)</button>
            </div>
            {el11 && (
              <div className="mt-2 text-[11px] text-slate-400">
                <p className={el11.state === "Connected" ? "text-emerald-300/90" : "text-rose-300/90"}>{el11.detail}</p>
                {el11.voice && <p>Voice: {el11.voice}</p>}
                {el11.tier && <p>Tier: {el11.tier} · used {el11.used}/{el11.limit} chars</p>}
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-500">If TTS shows &quot;detected_unusual_activity&quot;, ElevenLabs blocked free-tier generation (usually a VPN/proxy or flagged IP). Turn off VPN or use a paid tier. Until it works, JARVIS uses Gemini TTS, or <b>BROWSER FALLBACK</b> — clearly labeled, never silently.</p>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Per-character voices (ElevenLabs voice ID + Gemini voice) are set on the Characters screen. Without a Gemini or ElevenLabs key, replies use the browser voice.
          </p>
        </section>

        {/* Master Character Voice — ONE locked identity across every response */}
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-slate-400">Master character voice</h2>
          <p className="mb-3 text-xs text-slate-500">One consistent female voice for your character everywhere. Emotion changes the delivery, never the identity. When locked, this overrides per-character voices.</p>
          <div className="mb-3"><ToggleControl label="Lock master voice" desc="Use the same voice for every reply (recommended)" value={s.masterVoiceEnabled} onToggle={() => patch({ masterVoiceEnabled: !s.masterVoiceEnabled })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Gemini voice (free)</label>
              <select className="input" value={s.masterGeminiVoice} onChange={(e) => patch({ masterGeminiVoice: e.target.value })}>
                {(geminiVoices.length ? geminiVoices : [s.masterGeminiVoice]).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div><label className="label">ElevenLabs voice</label>
              {elevenVoices.length ? (
                <select className="input" value={s.masterElevenVoiceId ?? ""} onChange={(e) => patch({ masterElevenVoiceId: e.target.value })}>
                  <option value="">Default female (Bella)</option>
                  {elevenVoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              ) : (
                <input className="input" placeholder="voice id (or clone below)" defaultValue={s.masterElevenVoiceId ?? ""} onBlur={(e) => patch({ masterElevenVoiceId: e.target.value })} />
              )}
            </div>
            <div><label className="label flex justify-between"><span>Speaking speed</span><span>{s.voiceSpeed.toFixed(2)}×</span></label>
              <input type="range" min={0.7} max={1.2} step={0.05} className="w-full accent-cyan-400" value={s.voiceSpeed} onChange={(e) => patch({ voiceSpeed: Number(e.target.value) })} />
            </div>
            <div><label className="label flex justify-between"><span>Emotion intensity</span><span>{Math.round(s.emotionIntensity * 100)}%</span></label>
              <input type="range" min={0} max={1.5} step={0.1} className="w-full accent-violet-500" value={s.emotionIntensity} onChange={(e) => patch({ emotionIntensity: Number(e.target.value) })} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={testVoice}>🔊 Test voice</button>
            <button className="btn btn-ghost" onClick={testLipSync}>👄 Test lip-sync</button>
            {lipTest > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-3 py-1 text-xs text-cyan-200">
                mouth <span className="inline-block rounded-full bg-cyan-300" style={{ width: 10, height: 6 + lipTest * 22 }} />
              </span>
            )}
          </div>

          {/* Custom voice (clone) — honest status */}
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-200">Custom character voice (clone)</div>
              <span className={`chip ${s.customVoiceStatus === "active" ? "text-emerald-300" : s.customVoiceStatus === "reference_ready" ? "text-amber-300" : ""}`}>
                {s.customVoiceStatus === "active" ? "✔ custom voice active" : s.customVoiceStatus === "reference_ready" ? "reference ready · not active" : "no custom voice"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Upload a clean sample of your character&apos;s voice. With an ElevenLabs key that has voice-cloning, it becomes the real master voice. Without cloning access it&apos;s saved as a reference only — we won&apos;t pretend the clip is a TTS voice.</p>
            <label className="btn btn-ghost mt-2 inline-block cursor-pointer text-xs">
              🎤 Upload voice reference
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVoiceReference(f); e.target.value = ""; }} />
            </label>
            {cloneStatus && <p className={`mt-2 text-xs ${cloneStatus.startsWith("✔") ? "text-emerald-300" : "text-amber-300"}`}>{cloneStatus}</p>}
          </div>
        </section>

        {/* Character rendering */}
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-slate-400">Character rendering</h2>
          <p className="mb-3 text-xs text-slate-500">How your anime character is shown. Your emotion videos look great but can&apos;t lip-sync arbitrary words; the animated face gives true audio-synced lips.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Render mode</label>
              <select className="input" value={s.renderMode} onChange={(e) => patch({ renderMode: e.target.value })}>
                <option value="avatar">Animated face — true lip-sync from audio</option>
                <option value="video">Your emotion videos — visual only (not lip-synced)</option>
              </select>
            </div>
            <div className="flex items-end">
              <ToggleControl label="Lip-sync" desc="Move the mouth with the spoken audio" value={s.lipSyncEnabled} onToggle={() => patch({ lipSyncEnabled: !s.lipSyncEnabled })} />
            </div>
          </div>
        </section>

        {/* Provider health */}
        <section className="panel p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Provider health — which APIs work</h2>
            <button className="btn btn-ghost !py-1 text-xs" onClick={checkHealth} disabled={checking}>{checking ? "Checking…" : "Check now"}</button>
          </div>
          <p className="mb-3 text-xs text-slate-500">Live probe of every key you&apos;ve entered. Green = working, red = failing (with the status code so you can fix it).</p>
          {!health && <p className="text-xs text-slate-500">Tap “Check now” to probe your configured providers.</p>}
          {health && !health.anyConfigured && <p className="text-xs text-amber-300">No providers configured yet — add a key below.</p>}
          {health && health.results.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {health.results.map((r, i) => (
                <div key={i} className={`flex items-center justify-between rounded-xl border p-2.5 text-xs ${r.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                  <div>
                    <div className="font-medium text-slate-100">{r.ok ? "🟢" : "🔴"} {r.provider} <span className="text-slate-500">· {r.tier}</span></div>
                    <div className="text-[10px] text-slate-400">{r.model} · status {r.status}</div>{r.detail && <div className="mt-1 max-w-[24rem] break-words text-[10px] text-rose-300/80">{r.detail}</div>}
                  </div>
                  <span className="text-slate-400">{r.latencyMs}ms</span>
                </div>
              ))}
            </div>
          )}
          {health && <p className="mt-2 text-[10px] text-slate-500">Checked {new Date(health.checkedAt).toLocaleTimeString()}</p>}
        </section>

        {/* Token router */}
        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">Token router & cost control</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Routing mode</label>
              <select className="input" value={s.routerMode} onChange={(e) => patch({ routerMode: e.target.value })}>
                <option value="auto">Auto (complexity-based)</option><option value="fast">Always fast/cheap</option><option value="smart">Always smart</option><option value="local">Local (Ollama) first</option>
              </select>
            </div>
            <div><label className="label">Daily budget (USD)</label><input className="input" type="number" step="0.1" min="0" defaultValue={s.dailyBudgetUsd} onBlur={(e) => patch({ dailyBudgetUsd: Number(e.target.value) })} /></div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
  <div><label className="label">Chat model mode</label><select className="input" value={s.chatModelMode} onChange={(e) => patch({ chatModelMode: e.target.value })}><option value="auto">Auto routing</option><option value="selected">Selected model</option></select></div>
  <div><label className="label">Chat provider</label><input className="input" value={s.chatProvider ?? ""} onChange={(e) => setS({ ...s, chatProvider: e.target.value })} onBlur={(e) => patch({ chatProvider: e.target.value.trim() || null })} placeholder="openrouter" /></div>
  <div><label className="label">Chat model</label><input className="input" value={s.chatModel ?? ""} onChange={(e) => setS({ ...s, chatModel: e.target.value })} onBlur={(e) => patch({ chatModel: e.target.value.trim() || null })} placeholder="provider/model-id" /></div>
  </div>
  <div className="mt-3 grid gap-3 sm:grid-cols-3">
  <div><label className="label">Thinking model mode</label><select className="input" value={s.thinkingModelMode} onChange={(e) => patch({ thinkingModelMode: e.target.value })}><option value="auto">Auto reasoning</option><option value="selected">Selected model</option></select></div>
  <div><label className="label">Thinking provider</label><input className="input" value={s.thinkingProvider ?? ""} onChange={(e) => setS({ ...s, thinkingProvider: e.target.value })} onBlur={(e) => patch({ thinkingProvider: e.target.value.trim() || null })} placeholder="openrouter" /></div>
  <div><label className="label">Thinking model</label><input className="input" value={s.thinkingModel ?? ""} onChange={(e) => setS({ ...s, thinkingModel: e.target.value })} onBlur={(e) => patch({ thinkingModel: e.target.value.trim() || null })} placeholder="provider/model-id" /></div>
  </div>
  <p className="mt-2 text-[11px] text-slate-500">Audio models are isolated from thinking. Fish Audio can speak, but it will never answer chat messages.</p>
  <div className="mt-3"><ToggleControl label="Free-only mode" desc="Only route to free text providers and the offline engine" value={s.freeOnlyMode} onToggle={() => patch({ freeOnlyMode: !s.freeOnlyMode })} /></div>
          {usage && (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex justify-between text-xs text-slate-300"><span>Spent today</span><span>${usage.today.toFixed(4)} / ${usage.budget.toFixed(2)}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500" style={{ width: `${pct}%` }} /></div>
              <div className="mt-3 text-[10px] uppercase tracking-widest text-slate-500">Available models</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {usage.providers.length ? usage.providers.map((p, i) => <span key={i} className="chip">{p.tier} · {p.provider}/{p.model} {p.free ? "· free" : `· $${p.inPer1M}/$${p.outPer1M}`}</span>) : <span className="chip text-amber-300">offline persona engine only — add a key below</span>}
              </div>
            </div>
          )}
        </section>

        {/* Keys */}
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-slate-400">API keys (BYOK)</h2>
          <p className="mb-3 text-xs text-slate-500">Environment variables take priority. Keys entered here are stored in your local database for personal use. Groq offers a generous free tier — best place to start.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["groqKey", "Groq API key (free, fast)", "groq"],
              ["openaiKey", "OpenAI API key", "openai"],
              ["openrouterKey", "OpenRouter key (free models)", "openrouter"],
              ["elevenLabsKey", "ElevenLabs key (premium voice)", "elevenlabs"],
            ] as const).map(([k, label, envk]) => (
              <div key={k}><label className="label">{label} {s.envKeys[envk] && <span className="text-emerald-300">· set via env</span>}</label>
                <input className="input" type="password" placeholder={s[k] === "••••" ? "•••• (saved)" : "paste key"} defaultValue="" onBlur={(e) => e.target.value && patch({ [k]: e.target.value } as Partial<Settings>)} />
              </div>
            ))}
            <div><label className="label">Ollama URL (offline / on-device) {s.envKeys.ollama && <span className="text-emerald-300">· env</span>}</label><input className="input" placeholder="http://localhost:11434" defaultValue={s.ollamaUrl ?? ""} onBlur={(e) => patch({ ollamaUrl: e.target.value })} /></div>
          </div>
        </section>

        {/* OpenAI-compatible providers (key + base URL + model ID, like jarvish 1.0) */}
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-slate-400">OpenAI-compatible providers</h2>
          <p className="mb-3 text-xs text-slate-500">Same setup as jarvish 1.0 — API key, base URL and model ID per provider. Leave base URL / model blank to use the default shown in the placeholder.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { prefix: "tokenrouter", label: "TokenRouter", env: "tokenrouter", defBase: "https://api.tokenrouter.io/v1", defModel: "openai/gpt-5-mini" },
              { prefix: "qwen", label: "Qwen (DashScope)", env: "qwen", defBase: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", defModel: "qwen-plus" },
              { prefix: "aihub", label: "AIHubMix", env: "aihub", defBase: "https://aihubmix.com/v1", defModel: "gpt-4o-mini" },
              { prefix: "custom", label: "Custom (any OpenAI-compatible)", env: "custom", defBase: "https://openrouter.ai/api/v1", defModel: "gpt-4o-mini" },
            ] as const).map((pr) => (
              <div key={pr.prefix} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-200">{pr.label} {s.envKeys[pr.env] && <span className="text-emerald-300">· set via env</span>}</div>
                <div className="grid gap-2">
                  <input className="input" type="password" placeholder={s[`${pr.prefix}Key`] === "••••" ? "•••• (saved)" : "API key"} defaultValue="" onBlur={(e) => e.target.value && patch({ [`${pr.prefix}Key`]: e.target.value } as Partial<Settings>)} />
                  <input className="input" placeholder={`Base URL · default: ${pr.defBase}`} defaultValue={s[`${pr.prefix}BaseUrl`] ?? ""} onBlur={(e) => patch({ [`${pr.prefix}BaseUrl`]: e.target.value } as Partial<Settings>)} />
                  <input className="input" placeholder={`Model ID · default: ${pr.defModel}`} defaultValue={s[`${pr.prefix}Model`] ?? ""} onBlur={(e) => patch({ [`${pr.prefix}Model`]: e.target.value } as Partial<Settings>)} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Built-in provider model & base-URL overrides */}
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-slate-400">Model IDs &amp; base URLs</h2>
          <p className="mb-3 text-xs text-slate-500">Override the model IDs and base URLs for the built-in providers. Leave blank to use the default shown in the placeholder. Fast = quick chat, Smart = harder tasks.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { prefix: "groq", label: "Groq", defBase: "https://api.groq.com/openai/v1", defFast: "llama-3.1-8b-instant", defSmart: "llama-3.3-70b-versatile" },
              { prefix: "openai", label: "OpenAI", defBase: "https://api.openai.com/v1", defFast: "gpt-4o-mini", defSmart: "gpt-4o" },
              { prefix: "openrouter", label: "OpenRouter", defBase: "https://openrouter.ai/api/v1", defFast: "meta-llama/llama-3.1-8b-instruct:free", defSmart: "anthropic/claude-3.5-sonnet" },
            ] as const).map((pr) => (
              <div key={pr.prefix} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-200">{pr.label}</div>
                <div className="grid gap-2">
                  <input className="input" placeholder={`Base URL · default: ${pr.defBase}`} defaultValue={s[`${pr.prefix}BaseUrl`] ?? ""} onBlur={(e) => patch({ [`${pr.prefix}BaseUrl`]: e.target.value } as Partial<Settings>)} />
                  <input className="input" placeholder={`Fast model · default: ${pr.defFast}`} defaultValue={s[`${pr.prefix}FastModel`] ?? ""} onBlur={(e) => patch({ [`${pr.prefix}FastModel`]: e.target.value } as Partial<Settings>)} />
                  <input className="input" placeholder={`Smart model · default: ${pr.defSmart}`} defaultValue={s[`${pr.prefix}SmartModel`] ?? ""} onBlur={(e) => patch({ [`${pr.prefix}SmartModel`]: e.target.value } as Partial<Settings>)} />
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-200">Gemini {s.envKeys.gemini && <span className="text-emerald-300">· set via env</span>}</div>
              <div className="grid gap-2">
                <input className="input" type="password" placeholder={s.geminiKey === "••••" ? "•••• (saved)" : "Gemini API key (chat + free voice)"} defaultValue="" onBlur={(e) => e.target.value && patch({ geminiKey: e.target.value })} />
                <input className="input" placeholder="Fast model · default: gemini-2.5-flash" defaultValue={s.geminiFastModel ?? ""} onBlur={(e) => patch({ geminiFastModel: e.target.value })} />
                <input className="input" placeholder="Smart model · default: gemini-2.5-pro" defaultValue={s.geminiSmartModel ?? ""} onBlur={(e) => patch({ geminiSmartModel: e.target.value })} />
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-200">Ollama (local)</div>
              <div className="grid gap-2">
                <input className="input" placeholder="URL · default: http://localhost:11434" defaultValue={s.ollamaUrl ?? ""} onBlur={(e) => patch({ ollamaUrl: e.target.value })} />
                <input className="input" placeholder="Model · default: llama3.2" defaultValue={s.ollamaModel ?? ""} onBlur={(e) => patch({ ollamaModel: e.target.value })} />
              </div>
            </div>
          </div>
        </section>

        {/* Permissions */}
        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">Permission dashboard</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMS.map((p) => (
              <div key={p.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3">
                <div><div className="text-sm text-slate-100">{p.label}</div><div className="text-xs text-slate-400">{p.desc}</div></div>
                <button className={`btn !py-1 text-xs ${s.permissions?.[p.key] ? "btn-primary" : "btn-ghost"}`} onClick={() => requestPerm(p.key)}>{s.permissions?.[p.key] ? "Granted" : "Request"}</button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">🔒 All data stays in your local PostgreSQL. Encrypt the DB volume / use full-disk encryption on device for at-rest protection.</p>
        </section>
      </div>

      {/* Usage dashboard */}
      {usage && (
        <section className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">API usage (last 7 days)</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            {usage.byTier.map((t) => (
              <div key={t.tier} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs uppercase text-slate-500">{t.tier}</div>
                <div className="text-xl font-semibold text-white">{t.calls} <span className="text-xs font-normal text-slate-400">calls</span></div>
                <div className="text-xs text-slate-400">{t.tokensIn}↑ {t.tokensOut}↓ · ${t.cost.toFixed(4)} · {Math.round(t.avgLatency)}ms</div>
              </div>
            ))}
            {usage.byTier.length === 0 && <div className="text-sm text-slate-500">No usage yet.</div>}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500"><tr><th className="py-1">When</th><th>Tier</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Router reason</th></tr></thead>
              <tbody>
                {usage.recent.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 text-slate-300">
                    <td className="py-1">{new Date(r.createdAt).toLocaleTimeString()}</td><td>{r.tier}</td><td>{r.provider}/{r.model}</td><td>{r.tokensIn}↑ {r.tokensOut}↓</td><td>${r.costUsd.toFixed(5)}</td><td>{r.latencyMs}ms</td><td className="max-w-xs truncate text-slate-500">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
