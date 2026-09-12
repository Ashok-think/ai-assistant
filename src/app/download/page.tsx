import Link from "next/link";
import DownloadClient from "@/components/DownloadClient";
import { ArrowLeft, CheckCircle2, Laptop, ShieldCheck, Sparkles, RefreshCw } from "lucide-react";

const features = [
  "Private workspace with your own settings and paired devices",
  "Permission-based browser, screen, microphone, and file actions",
  "Jarvish folder for approved local notes and files",
  "Safe update checks that preserve your permissions and configuration",
];

export const metadata = {
  title: "Download Jarvish for Windows",
  description: "Install the Jarvish Windows companion and connect it to your private workspace.",
};

export default function DownloadPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft size={16} /> Back to Jarvish</Link>
      <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1.5 font-mono text-xs uppercase tracking-[0.16em] text-primary"><Laptop size={14} /> Windows companion</div>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">Give Jarvish a safe way to help on your computer.</h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">Download the companion, connect it to your private Jarvish workspace, and choose exactly what it can access. You stay in control of every sensitive action.</p>
          <div className="mt-8 flex flex-wrap gap-3"><DownloadClient /><Link href="/cloud" className="btn btn-ghost">Sign in to pair</Link></div>
          <p className="mt-4 text-xs text-muted-foreground">Windows 10 or later · Current release 0.2.0 · Setup preserves existing Jarvish settings</p>
        </section>
        <aside className="rounded-3xl border border-border bg-card p-6 shadow-[0_24px_80px_rgba(34,211,238,0.08)] md:p-8">
          <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles size={21} /></div><div><h2 className="font-semibold">What you get</h2><p className="text-sm text-muted-foreground">A private local bridge for approved tasks.</p></div></div>
          <ul className="mt-7 flex flex-col gap-4">{features.map((feature) => <li key={feature} className="flex items-start gap-3 text-sm leading-relaxed"><CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={17} />{feature}</li>)}</ul>
          <div className="mt-7 rounded-2xl border border-border bg-background/40 p-4"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={16} className="text-primary" /> Your data stays isolated</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Each person has a separate account, workspace, local folder, settings, and paired-device list.</p></div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={14} /> Updates are checked safely and never overwrite your permissions.</div>
          <div className="mt-7 border-t border-border pt-6"><h3 className="font-semibold">Install and pair</h3><ol className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground"><li><strong className="text-foreground">1. Download:</strong> Click Download for Windows. If the browser asks, keep the file.</li><li><strong className="text-foreground">2. Run:</strong> Open Downloads, right-click <code className="rounded bg-muted px-1">jarvish-windows-setup.ps1</code>, choose <span className="text-foreground">Run with PowerShell</span>. Keep the blue PowerShell window open until it says setup completed.</li><li><strong className="text-foreground">3. Pair:</strong> Sign in to Jarvish, open Cloud, choose your permissions, and approve pairing.</li><li><strong className="text-foreground">4. Test:</strong> Ask Jarvish to open a browser or create a file. Sensitive actions ask before running.</li></ol><p className="mt-3 text-xs text-muted-foreground">If Windows blocks the script, open PowerShell as your user, run <code className="rounded bg-muted px-1">Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code>, then run <code className="rounded bg-muted px-1">&apos;$HOME\Downloads\jarvish-windows-setup.ps1&apos;</code>. If it still closes, use <span className="text-foreground">Open in Terminal</span> from the Downloads folder so the error remains visible.</p></div>
          <div className="mt-6 border-t border-border pt-6"><h3 className="font-semibold">Bring your own API keys</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Keys stay in your private workspace and are never placed in the Windows installer. Sign in, open Settings, select Model settings, add a provider, and paste its key into the masked API key field. Use provider keys from the provider&apos;s official dashboard, then add one or more model IDs and test the connection.</p><p className="mt-3 text-xs text-muted-foreground">Never paste keys into chat, screenshots, PowerShell commands, or shared files. Rotate a key immediately if it is exposed.</p></div>
        </aside>
      </div>
    </main>
  );
}
