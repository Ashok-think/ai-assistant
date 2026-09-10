"use client";

export type AvatarEmotion = "happy" | "excited" | "sad" | "angry" | "shy" | "sleepy" | "neutral" | "thinking";

export type Viseme = "closed" | "mid" | "wide" | "round";

type Props = {
  color: string;
  accent: string;
  emoji: string;
  emotion: AvatarEmotion;
  talking: boolean;
  listening?: boolean;
  size?: number;
  /** 0..1 live mouth openness from the TTS audio (Web Audio AnalyserNode). */
  mouthLevel?: number;
  /** Coarse mouth shape from the audio's frequency balance. */
  viseme?: Viseme;
  /** Optional per-character portrait image; overlays the animated mouth on top. */
  imageUrl?: string | null;
};

/**
 * Procedural anime-style face: eyes/eyebrows/mouth change per emotion,
 * blinks on idle, mouth animates while talking (lip-sync driven by TTS state).
 */
export default function CharacterAvatar({ color, accent, emoji, emotion, talking, listening, size = 260, mouthLevel = 0, viseme = "mid", imageUrl }: Props) {
  const eyes = (() => {
    switch (emotion) {
      case "happy":
      case "excited":
        return { ry: emotion === "excited" ? 16 : 13, arc: true, browTilt: -4, sparkle: true };
      case "sad":
        return { ry: 11, arc: false, browTilt: 8, sparkle: false };
      case "angry":
        return { ry: 9, arc: false, browTilt: -14, sparkle: false };
      case "shy":
        return { ry: 10, arc: false, browTilt: 4, sparkle: true };
      case "sleepy":
        return { ry: 4, arc: false, browTilt: 2, sparkle: false };
      case "thinking":
        return { ry: 12, arc: false, browTilt: -6, sparkle: false };
      default:
        return { ry: 13, arc: false, browTilt: 0, sparkle: false };
    }
  })();

  const mouth = (() => {
    if (talking) return null;
    switch (emotion) {
      case "happy": return <path d="M118 158 Q140 176 162 158" stroke="#2b1b3a" strokeWidth="5" fill="none" strokeLinecap="round" />;
      case "excited": return <path d="M116 154 Q140 186 164 154 Z" fill="#2b1b3a" />;
      case "sad": return <path d="M120 168 Q140 152 160 168" stroke="#2b1b3a" strokeWidth="5" fill="none" strokeLinecap="round" />;
      case "angry": return <path d="M120 166 L160 160" stroke="#2b1b3a" strokeWidth="5" strokeLinecap="round" />;
      case "shy": return <path d="M128 162 Q140 168 152 162" stroke="#2b1b3a" strokeWidth="4" fill="none" strokeLinecap="round" />;
      case "sleepy": return <ellipse cx="140" cy="164" rx="7" ry="9" fill="#2b1b3a" />;
      case "thinking": return <path d="M124 164 Q140 158 156 166" stroke="#2b1b3a" strokeWidth="4" fill="none" strokeLinecap="round" />;
      default: return <path d="M124 162 L156 162" stroke="#2b1b3a" strokeWidth="4" strokeLinecap="round" />;
    }
  })();

  const ringColor = listening ? "#22d3ee" : talking ? accent : color;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* HUD rings */}
      <div className="absolute inset-0 rounded-full border border-dashed opacity-40 anim-spin-slow" style={{ borderColor: ringColor }} />
      <div className="absolute inset-[7%] rounded-full border opacity-30 anim-spin-rev" style={{ borderColor: accent, borderStyle: "dotted" }} />
      <div className={`absolute inset-[14%] rounded-full glow-ring ${talking || listening ? "anim-pulse-glow" : ""}`} style={{ ["--ring-color" as string]: `${ringColor}66` }} />
      <div className="absolute inset-[16%] overflow-hidden rounded-full">
        <div className="scanline" />
      </div>

      {imageUrl ? (
        // Portrait mode: real anime art with an audio-driven mouth overlay near the lower face.
        <div className={`absolute inset-[16%] overflow-hidden rounded-full ${talking ? "" : "anim-bob"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
          {talking && (
            <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" style={{ mixBlendMode: "multiply" }}>
              <ellipse
                cx="50"
                cy="72"
                rx={viseme === "wide" ? 9 : viseme === "round" ? 5 : 7}
                ry={1.5 + mouthLevel * 6}
                fill="#7a2233"
                opacity={0.55 + mouthLevel * 0.35}
              />
            </svg>
          )}
        </div>
      ) : (
      <div className={`relative ${talking ? "" : "anim-bob"}`} style={{ width: size * 0.62, height: size * 0.62 }}>
        <svg viewBox="0 0 280 280" className="h-full w-full drop-shadow-[0_0_30px_rgba(0,0,0,0.6)]">
          <defs>
            <radialGradient id="face" cx="50%" cy="40%">
              <stop offset="0%" stopColor="#fff5f0" />
              <stop offset="100%" stopColor="#ffd9c7" />
            </radialGradient>
            <linearGradient id="hair" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={accent} />
            </linearGradient>
          </defs>
          {/* hair back */}
          <ellipse cx="140" cy="128" rx="112" ry="118" fill="url(#hair)" />
          {/* face */}
          <ellipse cx="140" cy="150" rx="88" ry="96" fill="url(#face)" />
          {/* hair front / bangs */}
          <path d="M40 130 C50 40 230 40 240 130 C215 110 190 100 165 112 C150 90 130 90 118 112 C95 100 70 108 40 130 Z" fill="url(#hair)" />
          {/* blush */}
          {(emotion === "shy" || emotion === "happy" || emotion === "excited") && (
            <>
              <ellipse cx="88" cy="160" rx="16" ry="8" fill="#ff9ab0" opacity={emotion === "shy" ? 0.8 : 0.4} />
              <ellipse cx="192" cy="160" rx="16" ry="8" fill="#ff9ab0" opacity={emotion === "shy" ? 0.8 : 0.4} />
            </>
          )}
          {/* brows */}
          <line x1="86" y1={126 + eyes.browTilt} x2="118" y2={124 - eyes.browTilt * 0.4} stroke="#2b1b3a" strokeWidth="4" strokeLinecap="round" />
          <line x1="162" y1={124 - eyes.browTilt * 0.4} x2="194" y2={126 + eyes.browTilt} stroke="#2b1b3a" strokeWidth="4" strokeLinecap="round" />
          {/* eyes */}
          <g className="anim-blink">
            {eyes.arc ? (
              <>
                <path d="M88 148 Q102 132 116 148" stroke="#2b1b3a" strokeWidth="5" fill="none" strokeLinecap="round" />
                <path d="M164 148 Q178 132 192 148" stroke="#2b1b3a" strokeWidth="5" fill="none" strokeLinecap="round" />
              </>
            ) : (
              <>
                <ellipse cx="102" cy="146" rx="12" ry={eyes.ry} fill="#2b1b3a" />
                <ellipse cx="178" cy="146" rx="12" ry={eyes.ry} fill="#2b1b3a" />
                <ellipse cx="102" cy="142" rx="7" ry={Math.max(2, eyes.ry * 0.6)} fill={accent} />
                <ellipse cx="178" cy="142" rx="7" ry={Math.max(2, eyes.ry * 0.6)} fill={accent} />
                <circle cx="98" cy="139" r="3" fill="#fff" />
                <circle cx="174" cy="139" r="3" fill="#fff" />
              </>
            )}
          </g>
          {eyes.sparkle && (
            <>
              <text x="200" y="118" fontSize="18" fill="#fff">✦</text>
              <text x="62" y="128" fontSize="12" fill="#fff">✦</text>
            </>
          )}
          {emotion === "angry" && <text x="196" y="96" fontSize="26" fill="#ef4444">💢</text>}
          {emotion === "thinking" && <text x="200" y="104" fontSize="22" fill="#fff">…</text>}
          {/* mouth — audio-driven lip-sync when talking */}
          {talking ? (
            (() => {
              // Openness from the live audio level; shape from the viseme.
              const open = 3 + mouthLevel * 15; // vertical radius
              const wide = viseme === "wide" ? 20 : viseme === "round" ? 11 : 15; // horizontal radius
              const lip = mouthLevel > 0.05;
              return (
                <g className={mouthLevel > 0 ? "" : "anim-talk"}>
                  <ellipse cx="140" cy="164" rx={wide} ry={open} fill="#2b1b3a" />
                  {lip && <ellipse cx="140" cy={164 + open * 0.4} rx={wide * 0.55} ry={Math.max(2, open * 0.35)} fill="#ff7b9c" />}
                  {/* upper-teeth hint when wide open */}
                  {mouthLevel > 0.5 && <rect x={140 - wide * 0.7} y={164 - open + 1} width={wide * 1.4} height={2.5} rx={1} fill="#fff" opacity={0.85} />}
                </g>
              );
            })()
          ) : (
            mouth
          )}
        </svg>
        {emotion === "sleepy" && (
          <div className="absolute -right-2 top-2 text-lg text-cyan-200">
            <span className="anim-z inline-block">z</span>
            <span className="anim-z inline-block" style={{ animationDelay: "0.7s" }}>Z</span>
          </div>
        )}
        <div className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/50 text-lg backdrop-blur">
          {emoji}
        </div>
      </div>
      )}
    </div>
  );
}
