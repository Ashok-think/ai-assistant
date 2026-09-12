export type VoiceMode = "once" | "wake" | "auto";
export type VoicePhase = "idle" | "permission" | "starting" | "wake-listening" | "capturing" | "restarting" | "stopped" | "error";
export type VoiceSnapshot = { phase: VoicePhase; mode: VoiceMode | null; permission: "unknown" | "granted" | "denied"; heard: string; command: string; error: string };
export type RecognitionResults = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
export type Recognizer = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: RecognitionResults }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

export const INITIAL_VOICE: VoiceSnapshot = { phase: "idle", mode: null, permission: "unknown", heard: "", command: "", error: "" };
export const normalizeHeard = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function matchesWake(heard: string, phrase: string): { hit: boolean; rest: string } {
  const tokens = [...heard.matchAll(/[\p{L}\p{N}]+/gu)];
  const wake = normalizeHeard(phrase) || "hey rio";
  const variants = wake === "hey rio" ? ["hey rio", "hey reo", "hey ryo"] : [wake];
  for (let i = 0; i < tokens.length; i++) {
    for (const variant of variants) {
      const words = variant.split(" ");
      if (words.every((word, j) => tokens[i + j]?.[0].toLowerCase() === word)) {
        const last = tokens[i + words.length - 1];
        return { hit: true, rest: heard.slice(last.index! + last[0].length).replace(/^[\s,!.?:;\-]+/u, "").trim() };
      }
    }
  }
  return { hit: false, rest: "" };
}

export function readTranscript(results: RecognitionResults) {
  const final: string[] = [];
  const interim: string[] = [];
  for (let i = 0; i < results.length; i++) (results[i].isFinal ? final : interim).push(results[i][0].transcript);
  return { final: final.join(" ").trim(), interim: interim.join(" ").trim() };
}

export function voiceError(code: string) {
  if (["NotAllowedError", "not-allowed", "service-not-allowed"].includes(code)) return "Microphone or speech-service permission denied. Allow the microphone in Chrome site settings. In an embedded preview, open this page in a new tab and try again.";
  if (["NotFoundError", "audio-capture"].includes(code)) return "No usable microphone. Check the selected input and Windows microphone permissions.";
  if (["NotReadableError", "AbortError"].includes(code)) return "Microphone is busy or unavailable. Close other recording apps and retry.";
  if (code === "network") return "The browser speech service could not connect. Check internet access; Chrome speech recognition is not offline.";
  if (code === "unsupported") return "Speech recognition is unavailable. Use Chrome or Edge, or type your message.";
  if (code === "insecure") return "Microphone access requires HTTPS or localhost. Open a secure top-level page.";
  return `Speech recognition stopped (${code}). Retry or type your message.`;
}

type VoiceOptions = {
  create: () => Recognizer | null;
  permission: () => Promise<{ getTracks(): { stop(): void }[] }>;
  onChange: (snapshot: VoiceSnapshot) => void;
  onCommand: (command: string) => void;
  onInterrupt: () => void;
  isOccupied: () => boolean;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
};

export class VoiceSession {
  private options: VoiceOptions;
  private snapshot = { ...INITIAL_VOICE };
  private generation = 0;
  private recognition: Recognizer | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private silence: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private awakeUntil = 0;
  private settings = { mode: "once" as VoiceMode, phrase: "hey rio", language: "en-IN" };

  constructor(options: VoiceOptions) { this.options = options; }
  private now() { return (this.options.now ?? Date.now)(); }
  private update(patch: Partial<VoiceSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.options.onChange(this.snapshot); }
  private later(callback: () => void, ms: number) {
    const generation = this.generation;
    const timer = (this.options.setTimer ?? setTimeout)(() => { this.timers.delete(timer); if (generation === this.generation) callback(); }, ms);
    this.timers.add(timer);
    return timer;
  }
  private clear(timer: ReturnType<typeof setTimeout> | null) {
    if (timer === null) return;
    (this.options.clearTimer ?? clearTimeout)(timer);
    this.timers.delete(timer);
  }
  private detach() {
    const rec = this.recognition;
    this.recognition = null;
    if (rec) { rec.onstart = rec.onend = rec.onerror = rec.onresult = null; try { rec.abort(); } catch { /* Already ended. */ } }
  }
  stop(phase: "idle" | "stopped" = "stopped") {
    this.generation++;
    this.timers.forEach((timer) => (this.options.clearTimer ?? clearTimeout)(timer));
    this.timers.clear();
    this.silence = null;
    this.awakeUntil = 0;
    this.detach();
    this.update({ phase, mode: null, command: "", error: "" });
  }
  private fail(code: string) {
    this.stop("idle");
    this.update({ phase: "error", error: voiceError(code), ...(["NotAllowedError", "not-allowed", "service-not-allowed"].includes(code) ? { permission: "denied" as const } : {}) });
  }
  async start(mode: VoiceMode, phrase: string, language: string) {
    this.stop("idle");
    this.settings = { mode, phrase, language };
    this.retries = 0;
    const generation = this.generation;
    this.update({ phase: "permission", mode, heard: "", command: "" });
    try {
      const stream = await this.options.permission();
      stream.getTracks().forEach((track) => track.stop());
      if (generation !== this.generation) return;
      this.update({ permission: "granted" });
      this.open();
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.name : "permission-failed");
    }
  }
  private open() {
    const { mode, phrase, language } = this.settings;
    const generation = this.generation;
    let rec: Recognizer | null;
    try { rec = this.options.create(); } catch { this.fail("start-failed"); return; }
    if (!rec) { this.fail("unsupported"); return; }
    this.recognition = rec;
    const current = () => generation === this.generation && this.recognition === rec;
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    let final = "";
    let submitted = false;
    let consumed = "";
    let interrupted = false;
    let hadResults = false;
    let lastResult = "";
    let failure = "";
    const capturing = () => mode !== "wake" || this.awakeUntil > this.now();
    const command = (text: string) => {
      const hit = matchesWake(text, phrase);
      return hit.hit ? hit.rest : capturing() ? text.trim() : "";
    };
    const submit = () => {
      if (!current() || submitted) return;
      const text = command(final);
      if (!text) return;
      if (this.options.isOccupied() && !interrupted) return;
      submitted = true;
      this.awakeUntil = 0;
      this.clear(this.silence);
      this.detach();
      if (mode === "once") this.stop("idle");
      else { this.update({ phase: "restarting", command: "" }); this.later(() => this.open(), 350); }
      this.options.onCommand(text);
    };
    rec.onstart = () => { if (current()) this.update({ phase: capturing() ? "capturing" : "wake-listening", error: "" }); };
    rec.onresult = (event) => {
      if (!current() || failure) return;
      const result = readTranscript(event.results);
      const fingerprint = JSON.stringify(result);
      if (fingerprint === lastResult) return;
      lastResult = fingerprint;
      hadResults ||= Boolean(result.final);
      const heard = [result.final, result.interim].filter(Boolean).join(" ");
      this.update({ heard });
      const remaining = result.final.startsWith(consumed) ? result.final.slice(consumed.length).trim() : result.final;
      const wake = matchesWake(remaining, phrase);
      const stop = /^(stop|cancel|quiet|shush|enough|be quiet)[.!?]*$/i.test(remaining);
      // Interim hypotheses may be revised; only final wake/stop evidence can interrupt work.
      if (this.options.isOccupied() && !wake.hit && !stop && !interrupted) { consumed = result.final; final = ""; this.clear(this.silence); return; }
      if ((wake.hit || stop) && !interrupted) { interrupted = true; this.options.onInterrupt(); }
      if (!current()) return;
      if (stop) { this.awakeUntil = this.now() + 1000; final = "stop"; submit(); return; }
      final = remaining;
      if (mode === "wake" && wake.hit && !this.awakeUntil) {
        this.awakeUntil = this.now() + 8000;
        this.later(() => {
          if (this.awakeUntil && this.awakeUntil <= this.now()) {
            this.awakeUntil = 0;
            // Expiry can race an onend restart. Cancel that restart before opening a new recognizer.
            this.timers.forEach((timer) => (this.options.clearTimer ?? clearTimeout)(timer));
            this.timers.clear();
            this.silence = null;
            this.detach();
            if (mode === "wake") this.open();
          }
        }, 8000);
      }
      const shown = command(final);
      this.update({ phase: capturing() ? "capturing" : "wake-listening", command: capturing() ? [shown, result.interim].filter(Boolean).join(" ") : "" });
      this.clear(this.silence);
      if (shown && !result.interim) this.silence = this.later(submit, mode === "auto" ? 900 : 1200);
    };
    rec.onerror = (event) => {
      if (!current()) return;
      failure = event.error;
      if (!["network", "no-speech", "aborted"].includes(failure)) { this.fail(failure); return; }
      this.clear(this.silence);
      this.update({ phase: "restarting", error: failure === "network" ? voiceError(failure) : "" });
      this.later(() => { if (current()) rec.onend?.(); }, 1000);
    };
    rec.onend = () => {
      if (!current()) return;
      this.clear(this.silence);
      if (!failure) submit();
      if (!current()) return;
      this.detach();
      if (mode === "once") { if (failure === "network") this.fail(failure); else this.stop("idle"); return; }
      this.retries = hadResults && !failure ? 0 : this.retries + 1;
      if (this.retries > 4) { this.fail(failure || "repeated-session-end"); return; }
      this.update({ phase: "restarting", command: "" });
      this.later(() => this.open(), Math.min(400 * 2 ** this.retries, 5000));
    };
    this.update({ phase: "starting", command: "" });
    try { rec.start(); } catch (error) { this.fail(error instanceof Error ? error.name : "start-failed"); return; }
    this.later(() => { if (current() && this.snapshot.phase === "starting") this.fail("start-timeout"); }, 10000);
  }
}
