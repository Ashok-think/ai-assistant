"use client";

import { useEffect, useRef } from "react";
import { clipForEmotion, IDLE_CLIP } from "@/lib/character-assets";
import type { AvatarEmotion } from "./CharacterAvatar";

/**
 * VIDEO CHARACTER RENDERER
 * ------------------------
 * Shows the user's own AI-generated anime character as prerecorded EMOTION CLIPS. While the
 * assistant speaks, the clip for the current emotion loops so the character looks alive and
 * on-emotion; when idle it shows the neutral clip.
 *
 * HONEST NOTE: these are prerecorded videos. Their mouths do NOT match the exact spoken words —
 * a fixed clip cannot lip-sync arbitrary speech. For true audio-driven lip-sync use the
 * procedural avatar renderer (renderMode = "avatar"). This component is the "emotion visual"
 * layer, not a lip-sync engine, and we don't pretend otherwise.
 *
 * A subtle glow ring reflects listening/speaking so the state is still readable here.
 */
export default function VideoCharacter({
  emotion,
  talking,
  listening,
  size = 280,
  accent = "#22d3ee",
}: {
  emotion: AvatarEmotion;
  talking: boolean;
  listening?: boolean;
  size?: number;
  accent?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = talking ? clipForEmotion(emotion) : IDLE_CLIP;

  // Swap source when the clip changes; keep it muted+looping (audio comes from TTS, not the clip).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.src.endsWith(clip.src)) {
      v.src = clip.src;
      v.load();
    }
    v.play().catch(() => {});
  }, [clip.src]);

  const ring = listening ? "#22d3ee" : talking ? accent : "#64748b";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full border border-dashed opacity-40 anim-spin-slow" style={{ borderColor: ring }} />
      <div className={`absolute inset-[6%] rounded-full glow-ring ${talking || listening ? "anim-pulse-glow" : ""}`} style={{ ["--ring-color" as string]: `${ring}66` }} />
      <div className="absolute inset-[8%] overflow-hidden rounded-full border border-white/10 bg-black/40">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
        />
        {/* State chip so video mode still communicates listening/speaking honestly. */}
        {(talking || listening) && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur">
            {talking ? "speaking" : "listening"}
          </div>
        )}
      </div>
    </div>
  );
}
