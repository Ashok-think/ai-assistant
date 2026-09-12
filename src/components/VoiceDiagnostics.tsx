"use client";

import type { VoiceSnapshot } from "@/lib/voice-session";

export default function VoiceDiagnostics({ voice, phrase, language, stop, retry, pushToTalk }: { voice: VoiceSnapshot; phrase: string; language: string; stop: () => void; retry: () => void; pushToTalk: () => void }) {
  const active = !["idle", "stopped", "error"].includes(voice.phase);
  return (
    <details className="rounded-xl border border-border bg-background p-3 text-sm text-foreground" open={voice.phase === "error" ? true : undefined}>
      <summary className="cursor-pointer font-medium">Voice test · {voice.phase.replaceAll("-", " ")}</summary>
      <div className="flex flex-col gap-3 pt-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Permission</dt><dd>{voice.permission}</dd>
          <dt className="text-muted-foreground">Wake phrase</dt><dd>{phrase}</dd>
          <dt className="text-muted-foreground">Language</dt><dd>{language === "auto" ? "English (India) · automatic default" : language}</dd>
          <dt className="text-muted-foreground">Captured command</dt><dd className="break-words">{voice.command || "None"}</dd>
          <dt className="text-muted-foreground">Last heard</dt><dd className="break-words">{voice.heard || "No speech received"}</dd>
        </dl>
        {voice.error && <p role="alert" className="text-pretty">{voice.error}</p>}
        <p className="leading-relaxed text-muted-foreground">Keep this page open and allow microphone access. Say the full phrase, then your command. Browser recognition needs internet and is not a closed-browser wake engine. Headphones help reduce speaker echo.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={active ? stop : retry}>{active ? "Stop listening" : "Test wake phrase"}</button>
          <button type="button" className="btn btn-ghost" onClick={pushToTalk}>Push to talk</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}>Open in new tab</button>
        </div>
        <p className="text-muted-foreground">If the preview blocks the mic, try a new tab or use the message box. Local tools still require the local app.</p>
      </div>
    </details>
  );
}
