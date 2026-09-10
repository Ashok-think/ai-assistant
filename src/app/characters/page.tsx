"use client";

import { useCallback, useEffect, useState } from "react";
import CharacterAvatar, { type AvatarEmotion } from "@/components/CharacterAvatar";
import LiveCharacter from "@/components/LiveCharacter";
import { speak, stopSpeaking } from "@/lib/voice-client";

type Character = {
  id: number; slug: string; name: string; tagline: string; emoji: string; color: string; accent: string; personalityPrompt: string; speakingStyle: string;
  catchphrases: string[]; nickname: string; sliders: { funny: number; soft: number; calm: number }; voice: { pitch: number; rate: number; warmth: number; elevenLabsVoiceId?: string; geminiVoice?: string };
  defaultMood: string; isCustom: boolean;
};
type VoiceList = { hasElevenLabs: boolean; hasGemini: boolean; elevenlabs: { id: string; name: string }[]; elevenError: string | null; gemini: { id: string; name: string }[] };

const EMPTY: Omit<Character, "id" | "slug" | "isCustom"> = {
  name: "", tagline: "My custom companion", emoji: "✨", color: "#a855f7", accent: "#f0abfc",
  personalityPrompt: "", speakingStyle: "Casual, warm, natural, like a close friend.", catchphrases: [], nickname: "",
  sliders: { funny: 50, soft: 50, calm: 50 }, voice: { pitch: 1, rate: 1, warmth: 50 }, defaultMood: "happy",
};

const MOODS: AvatarEmotion[] = ["happy", "excited", "sad", "angry", "shy", "sleepy", "neutral", "thinking"];

export default function CharactersPage() {
  const [chars, setChars] = useState<Character[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const [previewMood, setPreviewMood] = useState<AvatarEmotion>("happy");
  const [talking, setTalking] = useState(false);
  const [mouth, setMouth] = useState<{ level: number; viseme: "closed" | "mid" | "wide" | "round" }>({ level: 0, viseme: "closed" });
  const [phraseInput, setPhraseInput] = useState("");
  const [voices, setVoices] = useState<VoiceList | null>(null);

  const load = useCallback(async () => {
    const [c, s, v] = await Promise.all([
      fetch("/api/characters").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/tts/voices").then((r) => r.json()).catch(() => null),
    ]);
    setChars(c);
    setActiveId(s.activeCharacterId);
    setVoices(v);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const activate = async (id: number) => {
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeCharacterId: id }) });
    setActiveId(id);
  };

  const preview = (c: { voice: Character["voice"]; catchphrases: string[]; name: string; nickname: string }) => {
    stopSpeaking();
    const line = c.catchphrases[0] ? `${c.catchphrases[0]} Hey ${c.nickname || "friend"}, it's ${c.name}.` : `Hey ${c.nickname || "friend"}, it's ${c.name}. Nice to meet you!`;
    speak(line, { voice: c.voice, emotion: previewMood, onStart: () => setTalking(true), onEnd: () => { setTalking(false); setMouth({ level: 0, viseme: "closed" }); }, onMouth: setMouth });
  };

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    const payload = { ...editing, personalityPrompt: editing.personalityPrompt || `You are ${editing.name}, a ${describe(editing.sliders)} best-friend companion who genuinely cares about the user.` };
    if (editing.id) await fetch(`/api/characters/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    else await fetch("/api/characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setEditing(null);
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this character?")) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Character Engine</h1>
          <p className="text-sm text-slate-400">Switch personas anytime by tap or voice (“switch to Ren”). Each one changes voice, word choice, emotion and greeting.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>＋ Create custom character</button>
      </header>

      {/* NEW: Live Talking AI Character (your uploaded anime girl). Existing cards below are unchanged. */}
      <LiveCharacter />

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] uppercase tracking-[0.25em] text-slate-500">Character library</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {chars.map((c) => (
          <div key={c.id} className={`panel relative overflow-hidden p-4 transition ${c.id === activeId ? "ring-1 ring-cyan-400/60" : ""}`}>
            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-30 blur-2xl" style={{ background: c.color }} />
            <div className="relative flex gap-3">
              <div className="shrink-0"><CharacterAvatar color={c.color} accent={c.accent} emoji={c.emoji} emotion={c.defaultMood as AvatarEmotion} talking={false} size={110} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold" style={{ color: c.accent }}>{c.name}</h2>
                  {c.id === activeId && <span className="chip text-cyan-300">active</span>}
                  {c.isCustom && <span className="chip">custom</span>}
                </div>
                <p className="text-xs text-slate-400">{c.tagline}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-300">“{c.catchphrases.join("” · “")}”</p>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                  <span className="chip">funny {c.sliders.funny}</span><span className="chip">soft {c.sliders.soft}</span><span className="chip">calm {c.sliders.calm}</span>
                </div>
              </div>
            </div>
            <div className="relative mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary !py-1.5 text-xs" onClick={() => activate(c.id)} disabled={c.id === activeId}>Use</button>
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => preview(c)}>🔊 Preview voice</button>
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setEditing({ ...c })}>Edit</button>
              {c.isCustom && <button className="btn btn-ghost !py-1.5 text-xs text-rose-300" onClick={() => remove(c.id)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="panel max-h-[92vh] w-full max-w-4xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing.id ? "Edit character" : "Custom Character Creator"}</h2>
              <button className="text-slate-400 hover:text-white" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-[260px_1fr]">
              <div className="flex flex-col items-center gap-2">
                <CharacterAvatar color={editing.color} accent={editing.accent} emoji={editing.emoji} emotion={previewMood} talking={talking} size={220} mouthLevel={mouth.level} viseme={mouth.viseme} />
                <div className="flex flex-wrap justify-center gap-1">
                  {MOODS.map((m) => <button key={m} className={`chip ${previewMood === m ? "text-cyan-300" : ""}`} onClick={() => setPreviewMood(m)}>{m}</button>)}
                </div>
                <button className="btn btn-ghost text-xs" onClick={() => preview({ ...editing, name: editing.name || "your companion" })}>🔊 Test voice</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Name</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Hikari" /></div>
                <div><label className="label">Calls you</label><input className="input" value={editing.nickname} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} placeholder="e.g. Senpai, Boss, Darling" /></div>
                <div><label className="label">Tagline</label><input className="input" value={editing.tagline} onChange={(e) => setEditing({ ...editing, tagline: e.target.value })} /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="label">Emoji</label><input className="input" value={editing.emoji} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} /></div>
                  <div><label className="label">Hair</label><input type="color" className="input h-9 p-1" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /></div>
                  <div><label className="label">Accent</label><input type="color" className="input h-9 p-1" value={editing.accent} onChange={(e) => setEditing({ ...editing, accent: e.target.value })} /></div>
                </div>

                <div className="sm:col-span-2 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-3">
                  {(["funny", "soft", "calm"] as const).map((k) => (
                    <div key={k}>
                      <label className="label flex justify-between"><span>{k === "funny" ? "Serious ↔ Funny" : k === "soft" ? "Strict ↔ Soft" : "Hyper ↔ Calm"}</span><span>{editing.sliders[k]}</span></label>
                      <input type="range" min={0} max={100} className="w-full accent-violet-500" value={editing.sliders[k]} onChange={(e) => setEditing({ ...editing, sliders: { ...editing.sliders, [k]: Number(e.target.value) } })} />
                    </div>
                  ))}
                </div>

                <div className="sm:col-span-2 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-4">
                  {(["pitch", "rate"] as const).map((k) => (
                    <div key={k}>
                      <label className="label flex justify-between"><span>Voice {k === "rate" ? "speed" : k}</span><span>{editing.voice[k].toFixed(2)}</span></label>
                      <input type="range" min={0.5} max={2} step={0.05} className="w-full accent-cyan-400" value={editing.voice[k]} onChange={(e) => setEditing({ ...editing, voice: { ...editing.voice, [k]: Number(e.target.value) } })} />
                    </div>
                  ))}
                  <div>
                    <label className="label flex justify-between"><span>Warmth</span><span>{editing.voice.warmth}</span></label>
                    <input type="range" min={0} max={100} className="w-full accent-pink-400" value={editing.voice.warmth} onChange={(e) => setEditing({ ...editing, voice: { ...editing.voice, warmth: Number(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="label">ElevenLabs voice</label>
                    {voices?.elevenlabs?.length ? (
                      <select className="input" value={editing.voice.elevenLabsVoiceId ?? ""} onChange={(e) => setEditing({ ...editing, voice: { ...editing.voice, elevenLabsVoiceId: e.target.value } })}>
                        <option value="">Default</option>
                        {voices.elevenlabs.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : (
                      <input className="input" value={editing.voice.elevenLabsVoiceId ?? ""} onChange={(e) => setEditing({ ...editing, voice: { ...editing.voice, elevenLabsVoiceId: e.target.value } })} placeholder={voices?.hasElevenLabs ? "voice id" : "add ElevenLabs key in Settings"} />
                    )}
                  </div>
                  <div>
                    <label className="label">Gemini voice</label>
                    <select className="input" value={editing.voice.geminiVoice ?? ""} onChange={(e) => setEditing({ ...editing, voice: { ...editing.voice, geminiVoice: e.target.value } })}>
                      <option value="">Default</option>
                      {(voices?.gemini ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="label">Catchphrases</label>
                  <div className="flex gap-2">
                    <input className="input" value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)} placeholder="Type and press Add" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (phraseInput.trim()) { setEditing({ ...editing, catchphrases: [...editing.catchphrases, phraseInput.trim()] }); setPhraseInput(""); } } }} />
                    <button className="btn btn-ghost" onClick={() => { if (phraseInput.trim()) { setEditing({ ...editing, catchphrases: [...editing.catchphrases, phraseInput.trim()] }); setPhraseInput(""); } }}>Add</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {editing.catchphrases.map((p, i) => <span key={i} className="chip">“{p}” <button onClick={() => setEditing({ ...editing, catchphrases: editing.catchphrases.filter((_, j) => j !== i) })}>✕</button></span>)}
                  </div>
                </div>
                <div><label className="label">Default mood</label>
                  <select className="input" value={editing.defaultMood} onChange={(e) => setEditing({ ...editing, defaultMood: e.target.value })}>{MOODS.map((m) => <option key={m}>{m}</option>)}</select>
                </div>
                <div><label className="label">Speaking style</label><input className="input" value={editing.speakingStyle} onChange={(e) => setEditing({ ...editing, speakingStyle: e.target.value })} /></div>
                <div className="sm:col-span-2"><label className="label">Personality prompt (auto-generated from sliders if empty)</label>
                  <textarea className="input min-h-24" value={editing.personalityPrompt} onChange={(e) => setEditing({ ...editing, personalityPrompt: e.target.value })} placeholder={`You are ${editing.name || "…"}, a ${describe(editing.sliders)} companion…`} />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.name.trim()}>Save character</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function describe(s: { funny: number; soft: number; calm: number }) {
  return [
    s.funny > 66 ? "very funny, playful" : s.funny < 33 ? "serious, focused" : "balanced",
    s.soft > 66 ? "gentle, soft-hearted" : s.soft < 33 ? "strict, tough-love" : "kind but honest",
    s.calm > 66 ? "calm, composed" : s.calm < 33 ? "hyper, high-energy" : "steady",
  ].join(", ");
}
