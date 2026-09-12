"use client";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Pencil, Trash2, Plus, ArrowRight } from "lucide-react";

export type CloudRow = { id: string; [key: string]: unknown };
export async function cloudFetch(url: string): Promise<{ data: CloudRow[] }> {
  const response = await fetch(url, { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Cloud request failed.");
  return json;
}
type Field = { key: string; label: string; kind?: "textarea" | "number" | "select"; options?: string[]; min?: number; max?: number; step?: number; required?: boolean };
const forms: Record<string, Field[]> = {
  memories: [{ key: "content", label: "What should JARVISH remember?", kind: "textarea", required: true, max: 10000 }, { key: "kind", label: "Kind", kind: "select", options: ["fact", "preference", "goal", "event", "person"] }, { key: "importance", label: "Importance (1–5)", kind: "number", min: 1, max: 5, step: 1 }],
  conversations: [{ key: "title", label: "Conversation title", required: true, max: 200 }],
  messages: [{ key: "content", label: "Message", kind: "textarea", required: true, max: 100000 }],
  character_profiles: [{ key: "name", label: "Character name", required: true, max: 100 }, { key: "personality", label: "Personality notes", kind: "textarea", max: 10000 }],
  voice_profiles: [{ key: "name", label: "Voice profile name", required: true, max: 100 }, { key: "speed", label: "Voice speed (0.75–1.50)", kind: "number", min: 0.75, max: 1.5, step: 0.05 }, { key: "language", label: "Language", kind: "select", options: ["en", "te", "hi", "hinglish"] }],
  profiles: [{ key: "display_name", label: "Display name", max: 100 }],
};
export default function CloudRecords({ entity, userId, conversationId, onConversation }: { entity: string; userId: string; conversationId?: string; onConversation?: (row: CloudRow) => void }) {
  const endpoint = `/api/cloud/${entity}${conversationId ? `?conversation_id=${conversationId}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR([endpoint, userId], ([url]) => cloudFetch(url));
  const [editing, setEditing] = useState<CloudRow | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fields = forms[entity];
  const rows = data?.data ?? [];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    fields.forEach((field) => { body[field.key] = field.kind === "number" ? Number(fd.get(field.key)) : String(fd.get(field.key) ?? ""); });
    if (entity === "messages" && !editing) body.conversation_id = conversationId;
    setBusy(true); setNotice("");
    try {
      const res = await fetch(`/api/cloud/${entity}${editing ? `?id=${editing.id}` : ""}`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setEditing(undefined); await mutate(); setNotice("Saved to your cloud account.");
    } catch (err) { setNotice((err as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setNotice("");
    try {
      const res = await fetch(`/api/cloud/${entity}?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      setDeleting(null); await mutate(); setNotice("Record deleted.");
    } catch (err) { setNotice((err as Error).message); }
    finally { setBusy(false); }
  }
  const title = (row: CloudRow) => String(row.title ?? row.name ?? row.display_name ?? row.content ?? row.action ?? row.id);
  return <div className="flex flex-col gap-5">
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{isLoading ? "Loading from Supabase…" : `${rows.length} records · latest 100`} </p>{fields && !(entity === "profiles" && rows.length > 0) && <button className="btn btn-primary" disabled={busy} onClick={() => { setEditing(null); setNotice(""); }}><Plus size={16} />{entity === "profiles" ? "Create profile" : "Add record"}</button>}</div>
    {error && <div role="alert" className="rounded-xl border border-border p-4 text-sm">{error.message} <button className="text-primary underline" onClick={() => mutate()}>Retry</button></div>}
    {editing !== undefined && fields && <form key={editing?.id ?? "new"} onSubmit={save} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-foreground">
      <h3 className="font-semibold">{editing ? "Edit record" : "New record"}</h3>
      {fields.map((field) => <label key={field.key} className="flex flex-col gap-2 text-sm">{field.label}
        {field.kind === "textarea" ? <textarea className="input min-h-28" name={field.key} required={field.required} maxLength={field.max} defaultValue={String(editing?.[field.key] ?? "")} disabled={busy} />
          : field.kind === "select" ? <select className="input" name={field.key} defaultValue={String(editing?.[field.key] ?? field.options?.[0])} disabled={busy}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
          : <input className="input" name={field.key} type={field.kind === "number" ? "number" : "text"} required={field.required || field.kind === "number"} min={field.min} max={field.max} step={field.step} maxLength={field.kind === "number" ? undefined : field.max} defaultValue={String(editing?.[field.key] ?? (field.key === "speed" ? 1 : field.key === "importance" ? 3 : ""))} disabled={busy} />}
      </label>)}
      <div className="flex gap-3"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save to cloud"}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</button></div>
    </form>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {!isLoading && !error && rows.length === 0 && <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center"><h3 className="font-medium">Nothing here yet.</h3><p className="mt-2 text-sm text-muted-foreground">{fields ? "Add your first record. Local SQLite data has not been imported." : "No cloud events have been recorded for your account."}</p></div>}
    <div className="flex flex-col gap-3">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-border bg-card p-5 text-foreground">
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="whitespace-pre-wrap break-words leading-relaxed">{title(row)}</p><p className="mt-2 break-words text-sm text-muted-foreground">{entity === "audit_logs" ? `${row.entity_type} · ${row.entity_id}` : row.kind ? `${row.kind} · importance ${row.importance}` : entity === "voice_profiles" ? `${row.language} · ${row.speed}x · playback not connected` : entity === "character_profiles" ? "Renderer unconfigured — a real rig or backend is required" : row.role ? String(row.role) : "Private cloud record"}</p></div>
        {fields && <div className="flex shrink-0 gap-2"><button className="btn btn-ghost" aria-label={`Edit ${entity === "memories" || entity === "messages" ? "record" : title(row)}`} disabled={busy} onClick={() => setEditing(row)}><Pencil size={16} /></button><button className="btn btn-ghost" aria-label="Delete record" disabled={busy} onClick={() => setDeleting(row.id)}><Trash2 size={16} /></button></div>}
      </div>
      {entity === "conversations" && <button className="mt-4 inline-flex items-center gap-2 text-sm text-primary" onClick={() => onConversation?.(row)}>Open messages<ArrowRight size={16} /></button>}
      {deleting === row.id && <div role="group" aria-label="Confirm deletion" className="mt-4 rounded-xl border border-border p-4"><p className="text-sm">Delete this record{entity === "conversations" ? " and all its messages" : ""}? This cannot be undone.</p><div className="mt-3 flex gap-3"><button className="btn btn-primary" disabled={busy} onClick={() => remove(row.id)}>Confirm delete</button><button className="btn btn-ghost" disabled={busy} onClick={() => setDeleting(null)}>Keep record</button></div></div>}
    </article>)}</div>
  </div>;
}
