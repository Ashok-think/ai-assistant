import "server-only";
import { getSettings } from "./bootstrap";
import { buildCatalog } from "./router";

/**
 * SHARED VISION LAYER
 * -------------------
 * One place that turns an image + question into a description using whichever vision-capable
 * model the user has a key for. Used by both screen-reading and image-upload. If no vision key
 * is configured it returns a truthful "not available" — never an invented description.
 *
 * The image is forwarded to the model and dropped; it is never stored or logged.
 */

const VISION_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  openrouter: "google/gemini-2.0-flash-001",
  groq: "meta-llama/llama-4-scout-17b-16e-instruct",
};

export type VisionResult =
  | { ok: true; description: string; model: string; provider: string }
  | { ok: false; status: number; error: string };

export function isImageDataUrl(s: string): boolean {
  return /^data:image\/(png|jpe?g|webp);base64,/.test(s);
}

export async function analyzeImage(image: string, question: string, systemHint?: string): Promise<VisionResult> {
  if (!isImageDataUrl(image)) return { ok: false, status: 400, error: "image must be a png/jpeg/webp data URL" };
  if (image.length > 12_000_000) return { ok: false, status: 413, error: "image too large" };

  const st = await getSettings();
  const candidates = buildCatalog(st).filter((c) => VISION_MODELS[c.spec.provider] && c.key);
  if (!candidates.length) {
    return {
      ok: false,
      status: 503,
      error: "No vision-capable API key configured. Add an OpenAI, Gemini, Groq or OpenRouter key in Settings and I'll be able to see images.",
    };
  }

  const system =
    systemHint ??
    "You are looking at an image the user shared. Answer their question about it in 2-6 short sentences. Read any visible text exactly. Never guess at things you can't actually see in the image. Don't mention that you're an AI.";

  const errors: string[] = [];
  for (const c of candidates) {
    const model = VISION_MODELS[c.spec.provider];
    try {
      const res = await fetch(`${c.spec.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          temperature: 0.3,
          messages: [
            { role: "system", content: system },
            { role: "user", content: [{ type: "text", text: question }, { type: "image_url", image_url: { url: image } }] },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        errors.push(`${c.spec.provider} ${res.status}`);
        continue;
      }
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const description = j.choices?.[0]?.message?.content?.trim();
      if (!description) {
        errors.push(`${c.spec.provider} returned nothing`);
        continue;
      }
      return { ok: true, description, model, provider: c.spec.provider };
    } catch (e) {
      errors.push(`${c.spec.provider}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return { ok: false, status: 502, error: `Every vision provider failed — ${errors.join("; ")}` };
}
