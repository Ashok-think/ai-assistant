"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, Bot, Brain, CircleHelp, LayoutDashboard, Settings2, Shapes, Sparkles } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Companion", icon: AudioLines },
  { href: "/agent", label: "Agent workspace", icon: LayoutDashboard },
  { href: "/characters", label: "Characters", icon: Bot },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/skills", label: "Skills", icon: Shapes },
  { href: "/settings", label: "Connections & settings", icon: Settings2 },
  { href: "/docs", label: "Help & setup", icon: CircleHelp },
];

export default function Nav({ assistantName, cloudOnly = false }: { assistantName?: string; cloudOnly?: boolean }) {
  const path = usePathname();
  const cloudItem = { href: "/cloud", label: "Cloud workspace", icon: LayoutDashboard };
  const items = cloudOnly ? [cloudItem] : [...ITEMS, cloudItem];
  return (
    <aside className="jarvish-rail">
      <Link href="/" className="rail-brand" aria-label="Jarvish home"><Sparkles size={24} strokeWidth={1.5} /></Link>
      <nav aria-label="Main navigation" className="rail-links">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} title={label} aria-label={label} aria-current={path === href ? "page" : undefined} className={`rail-link ${path === href ? "is-active" : ""}`}>
            <Icon size={21} strokeWidth={1.6} />
          </Link>
        ))}
      </nav>
      <div className="rail-profile" title={assistantName ?? "Your companion"}>J</div>
    </aside>
  );
}
