"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { performAction } from "@/lib/client-actions";

export default function ArtifactExportPanel({ enabled }: { enabled: boolean }) {
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"md" | "txt" | "xlsx" | "pdf">("md");
  const [content, setContent] = useState("");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);
  return <section className="panel flex flex-col gap-4 p-4 text-foreground" aria-labelledby="export-heading">
    <div className="flex items-center gap-2"><FileText size={20} aria-hidden="true" /><h2 id="export-heading" className="font-medium">Test a document export</h2></div>
    <p className="text-sm text-muted-foreground">Generate from your own content without a model call. Files are returned directly to your browser; no cloud copy is saved.</p>
    {!enabled && <p role="status" className="text-sm text-muted-foreground">Enable Document exports in the reviewed packages list first.</p>}
    <form className="flex flex-col gap-3" onSubmit={async (event) => {
      event.preventDefault(); if (pending || !enabled) return;
      setPending(true); setResult("Generating and verifying the download…");
      try {
        const outcome = await performAction({ kind: "download_artifact", title, label: title, format, content }, { userInitiated: true });
        setResult(outcome.detail);
      } finally { setPending(false); }
    }}>
      <label className="flex flex-col gap-1 text-sm">Document title<input className="input" value={title} required maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Research brief" /></label>
      <label className="flex flex-col gap-1 text-sm">Format<select className="input" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option><option value="xlsx">Spreadsheet (.xlsx)</option><option value="pdf">Plain PDF (.pdf)</option></select></label>
      <label className="flex flex-col gap-1 text-sm">{format === "xlsx" ? "Rows as JSON (first row is headers)" : "Document content"}<textarea className="input min-h-36 font-mono" required maxLength={20000} value={content} onChange={(event) => setContent(event.target.value)} placeholder={format === "xlsx" ? '[["Item","Count"],["Apples",3]]' : "Paste the reviewed content to export."} /></label>
      <p className="text-sm text-muted-foreground">{format === "xlsx" ? "Up to 200 rows × 30 columns. Text, numbers and booleans only; no formula execution." : format === "pdf" ? "Plain paginated text, not Typst typesetting. Unsupported characters are rejected; Markdown and text preserve Unicode." : "UTF-8 text; up to 20,000 characters."}</p>
      <button className="btn btn-primary self-start" disabled={!enabled || pending}><Download size={16} aria-hidden="true" />{pending ? "Generating…" : "Generate and download"}</button>
    </form>
    {result && <p role="status" aria-live="polite" className="break-words text-sm text-muted-foreground">{result}</p>}
  </section>;
}
