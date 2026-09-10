"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/agent", label: "Agent", icon: "🤖" },
  { href: "/characters", label: "Characters", icon: "🎭" },
  { href: "/memory", label: "Memory", icon: "🧠" },
  { href: "/skills", label: "Skills", icon: "🧩" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/docs", label: "Docs", icon: "📚" },
];

export default function Nav({ assistantName }: { assistantName?: string }) {
  const path = usePathname();
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="panel fixed left-4 top-4 bottom-4 hidden w-56 flex-col p-4 md:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="glow-ring flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-cyan-400 text-lg">✦</div>
          <div>
            <div className="text-sm font-semibold neon-text text-cyan-200">{assistantName ?? "Companion"}</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400">J.A.R.V.I.S. mode</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {ITEMS.map((it) => {
            const active = path === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-slate-300 hover:bg-white/5"}`}
              >
                <span>{it.icon}</span>
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[10px] leading-relaxed text-slate-500">
          Web companion · Flutter app skeleton in Docs · v2026.1
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="panel fixed inset-x-3 bottom-3 z-40 flex justify-around px-1 py-1.5 md:hidden">
        {ITEMS.map((it) => {
          const active = path === it.href;
          return (
            <Link key={it.href} href={it.href} className={`flex flex-col items-center rounded-lg px-2 py-1 text-[10px] ${active ? "text-cyan-300" : "text-slate-400"}`}>
              <span className="text-base">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
