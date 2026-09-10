import "server-only";
import type {
  BackendStatus, CancelResult, CreateJobInput, CreateJobResult, JobResult, JobStatus, JobStatusResult, TalkingCharacterProvider,
} from "./provider";

/**
 * REMOTE provider — sends (source video + TTS audio + emotion) to a configurable remote GPU
 * lip-sync backend and polls for the generated video. Vendor-neutral: no RunPod/Replicate/Colab
 * hard-coding. You point REMOTE_LIPSYNC_URL at any backend that implements the documented
 * contract (see docs/talking-character-backend.md).
 *
 * The API key is read from the server env only and sent as a Bearer header — never exposed to
 * the browser. If the URL isn't configured, every call fails honestly with "not configured".
 */
export class RemoteTalkingCharacterProvider implements TalkingCharacterProvider {
  readonly name = "remote" as const;
  private readonly base = (process.env.REMOTE_LIPSYNC_URL || "").replace(/\/+$/, "");
  private readonly key = process.env.REMOTE_LIPSYNC_API_KEY || "";
  private readonly origin = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.key ? { Authorization: `Bearer ${this.key}`, ...extra } : { ...extra };
  }

  private configured(): boolean { return this.base.length > 0; }

  async backendStatus(): Promise<BackendStatus> {
    if (!this.configured()) {
      return { provider: "remote", state: "not-configured", detail: "No REMOTE_LIPSYNC_URL set. Configure a GPU backend to enable AI video lip-sync.", canGenerate: false };
    }
    // Optional health probe: GET /health. Tolerate absence (some backends only expose create).
    try {
      const r = await fetch(`${this.base}/health`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
      if (r.ok) return { provider: "remote", state: "available", detail: `Remote GPU backend healthy at ${this.base}.`, canGenerate: true };
      // A non-OK health endpoint still means the URL is set; treat as ready-but-unverified.
      return { provider: "remote", state: "ready", detail: `Remote backend configured at ${this.base} (health ${r.status}).`, canGenerate: true };
    } catch {
      return { provider: "remote", state: "ready", detail: `Remote backend configured at ${this.base} (no /health; will try on generate).`, canGenerate: true };
    }
  }

  /** Fetch the source clip bytes so we can forward it as multipart to the backend. */
  private async fetchSource(sourceVideoUrl: string): Promise<{ bytes: Uint8Array; mime: string; filename: string } | null> {
    const url = sourceVideoUrl.startsWith("http") ? sourceVideoUrl : `${this.origin}${sourceVideoUrl}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "video/mp4";
      const filename = sourceVideoUrl.split("/").pop() || "source.mp4";
      return { bytes: buf, mime, filename };
    } catch {
      return null;
    }
  }

  async createTalkingVideo(input: CreateJobInput): Promise<CreateJobResult> {
    if (!this.configured()) return { ok: false, error: "Remote lip-sync not configured (REMOTE_LIPSYNC_URL missing)." };
    const src = await this.fetchSource(input.sourceVideoUrl);
    if (!src) return { ok: false, error: `Could not read source video ${input.sourceVideoUrl}.` };

    const fd = new FormData();
    // Copy into a fresh ArrayBuffer-backed view so Blob's BlobPart typing is satisfied.
    const toBlob = (b: Uint8Array, type: string) => new Blob([new Uint8Array(b).slice().buffer], { type });
    fd.append("source_video", toBlob(src.bytes, src.mime), src.filename);
    fd.append("audio", toBlob(input.audio.bytes, input.audio.mime), input.audio.filename);
    fd.append("emotion", input.emotion);
    fd.append("intensity", String(input.intensity));

    try {
      const r = await fetch(`${this.base}/create`, { method: "POST", headers: this.headers(), body: fd, signal: AbortSignal.timeout(60000) });
      const txt = await r.text();
      if (!r.ok) return { ok: false, error: `Backend /create ${r.status}: ${txt.slice(0, 200)}` };
      const j = JSON.parse(txt) as { jobId?: string; job_id?: string; id?: string; status?: string };
      const jobId = j.jobId || j.job_id || j.id;
      if (!jobId) return { ok: false, error: "Backend /create returned no jobId." };
      return { ok: true, jobId, status: (j.status as JobStatus) || "queued" };
    } catch (e) {
      return { ok: false, error: `create failed: ${(e as Error).message}` };
    }
  }

  async getJobStatus(jobId: string): Promise<JobStatusResult> {
    if (!this.configured()) return { ok: false, error: "Remote lip-sync not configured." };
    try {
      const r = await fetch(`${this.base}/status/${encodeURIComponent(jobId)}`, { headers: this.headers(), signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { ok: false, error: `status ${r.status}` };
      const j = (await r.json()) as { status?: string; progress?: number };
      return { ok: true, jobId, status: (j.status as JobStatus) || "unknown", progress: j.progress };
    } catch (e) {
      return { ok: false, error: `status failed: ${(e as Error).message}` };
    }
  }

  async getResult(jobId: string): Promise<JobResult> {
    if (!this.configured()) return { ok: false, error: "Remote lip-sync not configured." };
    try {
      const r = await fetch(`${this.base}/result/${encodeURIComponent(jobId)}`, { headers: this.headers(), signal: AbortSignal.timeout(20000) });
      if (!r.ok) return { ok: false, error: `result ${r.status}` };
      const j = (await r.json()) as { videoUrl?: string; video_url?: string; url?: string; status?: string };
      const videoUrl = j.videoUrl || j.video_url || j.url;
      if (!videoUrl) return { ok: false, error: "Backend /result returned no videoUrl.", status: (j.status as JobStatus) };
      return { ok: true, jobId, videoUrl };
    } catch (e) {
      return { ok: false, error: `result failed: ${(e as Error).message}` };
    }
  }

  async cancelJob(jobId: string): Promise<CancelResult> {
    if (!this.configured()) return { ok: false, error: "Remote lip-sync not configured." };
    try {
      const r = await fetch(`${this.base}/cancel/${encodeURIComponent(jobId)}`, { method: "POST", headers: this.headers(), signal: AbortSignal.timeout(10000) });
      if (!r.ok) return { ok: false, error: `cancel ${r.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `cancel failed: ${(e as Error).message}` };
    }
  }
}
