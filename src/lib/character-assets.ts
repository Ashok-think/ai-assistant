import type { AvatarEmotion } from "@/components/CharacterAvatar";

/**
 * CHARACTER VISUAL ASSETS
 * -----------------------
 * The user's own AI-generated anime character, as prerecorded emotion clips in
 * /public/character. These are EMOTION VISUALS — the character looks happy/angry/etc while
 * speaking. They are NOT dynamically lip-synced (a prerecorded clip can't match arbitrary
 * words); true audio-driven lip-sync is the procedural avatar mode. We're honest about that.
 *
 * The extended emotion set (laughing, surprised, confused, serious, calm) maps onto the clips we
 * actually have, so every emotion resolves to a real file.
 */

export type CharacterEmotion =
  | "neutral" | "happy" | "excited" | "laughing" | "sad" | "angry"
  | "surprised" | "confused" | "serious" | "calm" | "thinking" | "shy" | "sleepy";

export type CharacterClip = { src: string; label: string };

/** Clips that physically exist in /public/character. */
export const CLIPS = {
  neutral: "/character/neutral.mp4",
  happy: "/character/happy.mp4",
  angry: "/character/angry.mp4",
  calm: "/character/calm.mp4",
} as const;

/** Real MP3 audio extracted from each clip — used to PREVIEW the character's own voice. */
export const AUDIO = {
  neutral: "/character/neutral.mp3",
  happy: "/character/happy.mp3",
  angry: "/character/angry.mp3",
  calm: "/character/calm.mp3",
} as const;

/** The character's own recorded voice for a given emotion (preview only — not the TTS engine). */
export function audioForEmotion(emotion: string): string {
  const key = (["neutral", "happy", "angry", "calm"] as const).includes(emotion as "neutral")
    ? (emotion as keyof typeof AUDIO)
    : emotion === "excited" || emotion === "laughing" || emotion === "surprised"
      ? "happy"
      : emotion === "serious"
        ? "angry"
        : emotion === "sad" || emotion === "calm" || emotion === "shy" || emotion === "sleepy"
          ? "calm"
          : "neutral";
  return AUDIO[key];
}

/** Emotion → best available clip. Every emotion resolves to a real file. */
const EMOTION_TO_CLIP: Record<CharacterEmotion, keyof typeof CLIPS> = {
  neutral: "neutral",
  happy: "happy",
  excited: "happy",
  laughing: "happy",
  sad: "calm",
  angry: "angry",
  surprised: "happy",
  confused: "neutral",
  serious: "angry",
  calm: "calm",
  thinking: "neutral",
  shy: "calm",
  sleepy: "calm",
};

/** Resolve any emotion (including the AvatarEmotion set) to a real clip src. */
export function clipForEmotion(emotion: string): CharacterClip {
  const key = EMOTION_TO_CLIP[(emotion as CharacterEmotion)] ?? "neutral";
  return { src: CLIPS[key], label: key };
}

/** Idle clip when not speaking. */
export const IDLE_CLIP: CharacterClip = { src: CLIPS.neutral, label: "neutral" };

/** The voice reference asset (for the future custom/clone voice). May not exist yet. */
export const VOICE_REFERENCE = "/character/voice-reference.mp3";

/** Map the app's AvatarEmotion to the character emotion set (they overlap). */
export function toCharacterEmotion(e: AvatarEmotion): CharacterEmotion {
  return (["neutral", "happy", "excited", "sad", "angry", "shy", "sleepy", "thinking"] as const).includes(e)
    ? (e as CharacterEmotion)
    : "neutral";
}
