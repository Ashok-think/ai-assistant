import "server-only";

/**
 * TALKING CHARACTER PROVIDER
 * --------------------------
 * A clean, vendor-neutral abstraction for turning (source anime video + TTS audio + emotion)
 * into a NEW generated talking video with real AI lip-sync. The rest of JARVIS talks to this
 * interface only, so the actual engine (a remote GPU backend now; a local one later) can be
 * swapped without touching the app.
 *
 * Honesty rules baked in:
 *  - The LOCAL provider reports itself UNAVAILABLE on machines without a suitable GPU (this PC).
 *  - The REMOTE provider is only "ready" when an endpoint is actually configured; otherwise it
 *    says "not configured". Nothing pretends to render when no backend exists.
 *  - The API key lives server-side only and is never returned to the client.
 */

export type JobStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled" | "unknown";

export type BackendState = "not-configured" | "ready" | "processing" | "available" | "error";

export type CreateJobInput = {
  /** Public URL or absolute path of the source character clip (e.g. /character/neutral.mp4). */
  sourceVideoUrl: string;
  /** The TTS audio to lip-sync to, as bytes + mime (the EXACT audio that will be spoken). */
  audio: { bytes: Uint8Array; mime: string; filename: string };
  emotion: string;
  intensity: number;
};

export type CreateJobResult = { ok: true; jobId: string; status: JobStatus } | { ok: false; error: string };
export type JobStatusResult = { ok: true; jobId: string; status: JobStatus; progress?: number } | { ok: false; error: string };
export type JobResult = { ok: true; jobId: string; videoUrl: string } | { ok: false; error: string; status?: JobStatus };
export type CancelResult = { ok: true } | { ok: false; error: string };

export type BackendStatus = {
  provider: "local" | "remote" | "none";
  state: BackendState;
  detail: string;
  /** Whether a request could actually be sent right now. */
  canGenerate: boolean;
};

export interface TalkingCharacterProvider {
  readonly name: "local" | "remote";
  /** Report whether this provider can generate right now, and why/why not. Never lies. */
  backendStatus(): Promise<BackendStatus>;
  createTalkingVideo(input: CreateJobInput): Promise<CreateJobResult>;
  getJobStatus(jobId: string): Promise<JobStatusResult>;
  getResult(jobId: string): Promise<JobResult>;
  cancelJob(jobId: string): Promise<CancelResult>;
}
