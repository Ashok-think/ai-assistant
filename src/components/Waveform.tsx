"use client";

export default function Waveform({ active, color = "#22d3ee", bars = 24, level = 1 }: { active: boolean; color?: string; bars?: number; level?: number }) {
  return (
    <div className="flex h-10 items-end justify-center gap-[3px]">
      {Array.from({ length: bars }).map((_, i) => {
        const h = active ? 20 + Math.abs(Math.sin(i * 0.9)) * 20 * level : 4;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full ${active ? "wave-bar" : ""}`}
            style={{ height: h, background: color, animationDelay: `${(i % 6) * 0.08}s`, opacity: active ? 0.9 : 0.35, transition: "height .3s" }}
          />
        );
      })}
    </div>
  );
}
