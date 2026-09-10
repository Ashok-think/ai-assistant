import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  BackendStatus, CancelResult, CreateJobInput, CreateJobResult, JobResult, JobStatusResult, TalkingCharacterProvider,
} from "./provider";

const run = promisify(execFile);

/**
 * LOCAL provider — real AI video lip-sync on THIS machine.
 *
 * On a machine with a proper NVIDIA GPU + CUDA it could host a model (MuseTalk/SadTalker/etc).
 * This PC has only Intel UHD integrated graphics and CPU-only PyTorch, so it reports itself
 * UNAVAILABLE with the exact reason — it never attempts a slow/fake CPU render.
 */
export class LocalTalkingCharacterProvider implements TalkingCharacterProvider {
  readonly name = "local" as const;

  private async detectGpu(): Promise<{ nvidia: boolean; detail: string }> {
    try {
      const { stdout } = await run("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { timeout: 4000 });
      const name = stdout.trim().split("\n")[0]?.trim();
      if (name) return { nvidia: true, detail: `NVIDIA GPU detected: ${name}` };
      return { nvidia: false, detail: "nvidia-smi returned no GPU" };
    } catch {
      return { nvidia: false, detail: "No NVIDIA GPU / CUDA (nvidia-smi not available)" };
    }
  }

  async backendStatus(): Promise<BackendStatus> {
    const gpu = await this.detectGpu();
    if (!gpu.nvidia) {
      return {
        provider: "local",
        state: "not-configured",
        detail: `Local AI video lip-sync unavailable: ${gpu.detail}. This machine has no suitable GPU. Configure a remote GPU backend (TALKING_CHARACTER_PROVIDER=remote + REMOTE_LIPSYNC_URL).`,
        canGenerate: false,
      };
    }
    // Even with a GPU, a model runtime would still need to be installed; we don't claim it is.
    return {
      provider: "local",
      state: "not-configured",
      detail: `${gpu.detail}, but no local lip-sync model runtime is installed. Install a model server or use the remote backend.`,
      canGenerate: false,
    };
  }

  private unavailable(): { ok: false; error: string } {
    return {
      ok: false,
      error:
        "Local AI video lip-sync is unavailable on this machine (no NVIDIA GPU/CUDA, CPU-only PyTorch). Set TALKING_CHARACTER_PROVIDER=remote and REMOTE_LIPSYNC_URL to use a GPU backend.",
    };
  }

  async createTalkingVideo(input: CreateJobInput): Promise<CreateJobResult> { void input; return this.unavailable(); }
  async getJobStatus(jobId: string): Promise<JobStatusResult> { void jobId; return this.unavailable(); }
  async getResult(jobId: string): Promise<JobResult> { void jobId; return this.unavailable(); }
  async cancelJob(jobId: string): Promise<CancelResult> { void jobId; return this.unavailable(); }
}
