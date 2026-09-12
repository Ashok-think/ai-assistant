"use client";

import { toSpeechText } from "./speech-text";

/**
 * VOICE PIPELINE (web companion)
 *  wake word → STT (Web Speech API, streaming interim results) → /api/chat → TTS
 *  TTS: /api/tts (Gemini TTS → ElevenLabs, emotion-aware) → fallback to browser
 *       speechSynthesis with per-character pitch/rate.
 *  Interrupt: calling stopSpeaking() at any time (e.g., when the user starts talking) cuts audio.
 *  The Flutter app swaps these for Porcupine/openWakeWord + Whisper + ElevenLabs streaming.
 */

export type VoiceSettings = { pitch: number; rate: number; warmth: number; elevenLabsVoiceId?: string; geminiVoice?: string; ttsModel?: string; ttsVoice?: string; lang?: string };

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

type SRCtor = new () => SR;

export function getRecognizerCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function langToBcp47(lang: string): string {
  switch (lang) {
    case "hi":
    case "hinglish":
      return "hi-IN";
    case "te": // Telugu
    case "tenglish": // Telugu + English mixed — te-IN handles Telugu script + Indian-English words
      return "te-IN";
    case "ja":
      return "ja-JP";
    case "en":
      return "en-US";
    case "en-IN":
      return "en-IN";
    default:
      return typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  }
}

export function detectLangFromText(t: string): string {
  if (/[\u0C00-\u0C7F]/.test(t)) return "te-IN"; // Telugu block
  if (/[\u0900-\u097F]/.test(t)) return "hi-IN"; // Devanagari
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(t)) return "ja-JP"; // Japanese
  return "en-US";
}

export { matchesWake, normalizeHeard } from "./voice-session";

let speechGeneration = 0;
let speechRequest: AbortController | null = null;
let finishPlayback: (() => void) | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let mouthRaf = 0;
let sharedCtx: AudioContext | null = null;
// One MediaElementSource per <audio> element is allowed for the element's lifetime, so we
// cache them and reuse — creating a second source for the same element throws.
const sourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

/** A lip-sync frame: mouth openness 0..1 and a coarse viseme from the frequency spread. */
export type MouthFrame = { level: number; viseme: Viseme };
export type Viseme = "closed" | "mid" | "wide" | "round";

function stopMouth(onMouth?: (f: MouthFrame) => void) {
  if (mouthRaf) cancelAnimationFrame(mouthRaf);
  mouthRaf = 0;
  onMouth?.({ level: 0, viseme: "closed" });
}

export function stopSpeaking() {
  speechGeneration++;
  speechRequest?.abort();
  speechRequest = null;
  finishPlayback?.();
  finishPlayback = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
  if (mouthRaf) cancelAnimationFrame(mouthRaf);
  mouthRaf = 0;
}

/**
 * Drive a mouth from the live audio of an <audio> element using a Web Audio AnalyserNode.
 * Amplitude → openness; the low/high frequency balance → a coarse viseme (round/wide/mid).
 * Pure browser standard, no third-party code or assets.
 */
function attachLipSync(audio: HTMLAudioElement, onMouth: (f: MouthFrame) => void) {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    sharedCtx = sharedCtx ?? new AC();
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
    const src = sourceCache.get(audio) ?? sharedCtx.createMediaElementSource(audio);
    sourceCache.set(audio, src);
    const analyser = sharedCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    analyser.connect(sharedCtx.destination); // keep audio audible
    const bins = analyser.frequencyBinCount;
    const freq = new Uint8Array(bins);
    const loop = () => {
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      let low = 0;
      let high = 0;
      const mid = Math.floor(bins / 3);
      for (let i = 0; i < bins; i++) {
        sum += freq[i];
        if (i < mid) low += freq[i];
        else if (i > mid * 2) high += freq[i];
      }
      const avg = sum / bins / 255; // 0..1
      const level = Math.min(1, avg * 3.2); // amplify — speech rarely maxes the range
      const viseme: Viseme = level < 0.08 ? "closed" : high > low * 1.15 ? "wide" : low > high * 1.6 ? "round" : "mid";
      onMouth({ level, viseme });
      mouthRaf = requestAnimationFrame(loop);
    };
    loop();
  } catch {
    // Without audio samples there is no truthful amplitude-driven lip sync.
    stopMouth(onMouth);
  }
}


function emotionAdjust(emotion: string, v: VoiceSettings) {
  let pitch = v.pitch;
  let rate = v.rate;
  switch (emotion) {
    case "excited": pitch += 0.15; rate += 0.15; break;
    case "happy": pitch += 0.05; rate += 0.05; break;
    case "sad": pitch -= 0.15; rate -= 0.15; break;
    case "angry": pitch -= 0.05; rate += 0.1; break;
    case "shy": pitch += 0.1; rate -= 0.1; break;
    case "sleepy": pitch -= 0.1; rate -= 0.25; break;
  }
  // warmth nudges pitch slightly lower & rate slower for a softer feel
  pitch -= ((v.warmth - 50) / 100) * 0.1;
  return { pitch: Math.max(0.5, Math.min(2, pitch)), rate: Math.max(0.5, Math.min(2, rate)) };
}

/** Browser voices load asynchronously; on first paint getVoices() is often empty. */
function ensureVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const have = window.speechSynthesis.getVoices();
    if (have.length) return resolve(have);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.onvoiceschanged = finish;
    // Safety net: some browsers never fire the event. Kept short so browser-fallback speech isn't
    // delayed — voices almost always load in <250ms, and `finish` fires the instant they're ready.
    setTimeout(finish, 250);
  });
}

function pickVoice(lang: string, warmth: number): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const base = lang.split("-")[0];
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = sameLang.length ? sameLang : voices;
  const female = pool.filter((v) => /female|zira|samantha|karen|moira|tessa|veena|kyoko|google (uk english female|हिन्दी|日本語)/i.test(v.name + v.lang));
  const preferred = warmth >= 50 && female.length ? female : pool;
  return preferred.find((v) => /google|natural|neural/i.test(v.name)) ?? preferred[0] ?? null;
}

export async function speak(text: string, opts: { voice: VoiceSettings; emotion: string; lang?: string; onStart?: () => void; onEnd?: () => void; onMouth?: (f: MouthFrame) => void; onProvider?: (p: string) => void; onFallbackReason?: (reason: string) => void }): Promise<void> {
  stopSpeaking();
  const generation = speechGeneration;
  const controller = new AbortController();
  speechRequest = controller;
  const canceled = () => generation !== speechGeneration || controller.signal.aborted;
  // Natural spoken text only — never tags, JSON, tool traces, markdown symbols or code fences.
  const clean = toSpeechText(text);
  if (!clean) return;

  // 1) Server TTS (Gemini → ElevenLabs). 204 means no provider configured.
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voiceId: opts.voice.elevenLabsVoiceId, geminiVoice: opts.voice.geminiVoice, model: opts.voice.ttsModel, voice: opts.voice.ttsVoice, emotion: opts.emotion }),
      signal: controller.signal,
    });
    if (canceled()) return;
    if (r.status === 204) {
      // Server had no usable premium voice — tell the caller exactly why before the browser speaks.
      opts.onFallbackReason?.(r.headers.get("X-TTS-Fallback-Reason") ?? "no server TTS provider available");
    }
    if (r.status === 200) {
      opts.onProvider?.(r.headers.get("X-TTS-Provider") ?? "server");
      const blob = await r.blob();
      if (canceled()) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      // Speed is already baked in server-side (emotion + character sliders), so don't re-apply it here.
      await new Promise<void>((resolve) => {
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          URL.revokeObjectURL(url);
          sourceCache.get(audio)?.disconnect();
          stopMouth(opts.onMouth);
          opts.onEnd?.();
          if (finishPlayback === done) finishPlayback = null;
          resolve();
        };
        finishPlayback = done;
        audio.onplay = () => {
          opts.onStart?.();
          if (opts.onMouth) attachLipSync(audio, opts.onMouth);
        };
        audio.onended = () => { URL.revokeObjectURL(url); done(); };
        audio.onerror = () => done();
        audio.onpause = () => { if (audio.currentTime < audio.duration) done(); };
        audio.play().catch(() => done());
      });
      return;
    }
  } catch {
    /* fall through to browser TTS */
  }

  // 2) Browser speechSynthesis fallback
  if (canceled() || typeof window === "undefined" || !window.speechSynthesis) return;
  opts.onProvider?.("browser");
  await ensureVoices(); // wait for the voice list so we don't speak silently on first load
  if (canceled()) return;
  await new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      stopMouth(opts.onMouth);
      opts.onEnd?.();
      if (finishPlayback === done) finishPlayback = null;
      resolve();
    };
    finishPlayback = done;
    const u = new SpeechSynthesisUtterance(clean);
    const lang = opts.lang && opts.lang !== "auto" ? langToBcp47(opts.lang) : detectLangFromText(clean);
    u.lang = lang;
    const { pitch, rate } = emotionAdjust(opts.emotion, opts.voice);
    u.pitch = pitch;
    u.rate = rate;
    const v = pickVoice(lang, opts.voice.warmth);
    if (v) u.voice = v;
    u.onstart = () => {
      opts.onStart?.();
      // Browser synthesis does not expose audio samples; keep the mouth closed.
      stopMouth(opts.onMouth);
    };
    u.onend = done;
    u.onerror = done;
    currentUtterance = u;
    // Chrome sometimes leaves the queue paused; nudge it.
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
  });
}

/** Simple mic level + voice-tone estimator (energy + variability → excited / calm / low). */
export async function createToneAnalyzer(onLevel: (level: number, tone: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let ctx: AudioContext | undefined;
  let analyser: AnalyserNode;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void ctx?.close();
    throw error;
  }
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const history: number[] = [];
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    history.push(rms);
    if (history.length > 60) history.shift();
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, b) => a + (b - avg) ** 2, 0) / history.length;
    const tone = avg > 0.12 && variance > 0.004 ? "excited" : avg > 0.05 ? "calm" : avg > 0.015 ? "soft/low" : "quiet";
    onLevel(Math.min(1, rms * 4), tone);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}

export function isSpeaking(): boolean {
  return Boolean(currentAudio && !currentAudio.paused) || Boolean(currentUtterance && typeof window !== "undefined" && window.speechSynthesis.speaking);
}
