/**
 * CHARACTER STATE MACHINE
 * -----------------------
 * A tiny, pure derivation from real signals (voice + agent events) to a canonical character
 * state. Kept separate from the UI so the avatar just renders whatever state it's handed, and so
 * the same logic can drive a future 3D/video avatar provider.
 *
 * Every transition here is caused by a REAL event — the mic opening, a tool actually running, TTS
 * audio actually playing — never a decorative timer.
 */
import type { AvatarEmotion } from "@/components/CharacterAvatar";

export type CharacterState =
  | "idle"
  | "listening"
  | "thinking"
  | "searching"
  | "working"
  | "speaking"
  | "success"
  | "error";

/** The live signals the machine reduces over. */
export type CharacterSignals = {
  listening: boolean;
  talking: boolean;
  busy: boolean;
  /** Last agent action_step status seen this turn. */
  step?: "planning" | "searching" | "executing" | "verifying" | "completed" | "failed" | null;
  /** Name of the tool currently running, if any (e.g. "pc_youtube_search"). */
  tool?: string | null;
};

/** Reduce signals → state. Order matters: the most specific/active wins. */
export function deriveState(s: CharacterSignals): CharacterState {
  if (s.talking) return "speaking";
  if (s.listening && !s.busy) return "listening";
  if (s.step === "failed") return "error";
  if (s.step === "completed") return "success";
  if (s.busy) {
    if (s.step === "searching" || /search|google|youtube_search|find/.test(s.tool ?? "")) return "searching";
    if (s.step === "executing" || s.step === "verifying" || (s.tool && s.tool !== "")) return "working";
    return "thinking";
  }
  return "idle";
}

/** A believable, subtle emotion for each state (used when the reply hasn't set one yet). */
export function emotionForState(state: CharacterState, replyEmotion?: AvatarEmotion): AvatarEmotion {
  if (state === "speaking" && replyEmotion) return replyEmotion;
  switch (state) {
    case "listening": return "neutral";
    case "thinking": return "thinking";
    case "searching": return "thinking";
    case "working": return "neutral";
    case "success": return "happy";
    case "error": return "sad";
    case "speaking": return replyEmotion ?? "happy";
    default: return replyEmotion ?? "happy";
  }
}

/** Short human label + icon for the HUD status line. Maps 1:1 to real activity. */
export function stateLabel(state: CharacterState, tool?: string | null): { icon: string; text: string } {
  switch (state) {
    case "listening": return { icon: "🎧", text: "Listening…" };
    case "thinking": return { icon: "🧠", text: "Thinking…" };
    case "searching": return { icon: "🔎", text: "Searching…" };
    case "working": return { icon: tool?.startsWith("pc_") ? "🌐" : "⚙️", text: tool ? `Working: ${tool}` : "Working…" };
    case "speaking": return { icon: "🗣️", text: "Speaking…" };
    case "success": return { icon: "✓", text: "Done" };
    case "error": return { icon: "⚠️", text: "Something failed" };
    default: return { icon: "•", text: "Ready" };
  }
}
