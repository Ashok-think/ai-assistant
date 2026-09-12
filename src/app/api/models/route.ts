import { getSettings } from "@/lib/bootstrap";
import { buildCatalog } from "@/lib/router";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  const seen = new Set<string>();
  const models = buildCatalog(settings)
    .filter(({ spec }) => spec.provider !== "offline" && spec.provider !== "gateway")
    .filter(({ spec }) => {
      const key = `${spec.provider}/${spec.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ spec, tier, key }) => ({
      id: `${spec.provider}/${spec.model}`,
      provider: spec.provider,
      model: spec.model,
      tier,
      capability: spec.provider === "tokenrouter" || spec.provider === "openrouter" || spec.provider === "openai" || spec.provider === "groq" || spec.provider === "gemini" || spec.provider === "qwen" || spec.provider === "aihub" || spec.provider === "custom" ? "text" : "local",
      supportsTools: spec.supportsTools,
      free: spec.free,
      configured: Boolean(key),
      label: `${spec.provider} · ${spec.model}`,
    }));

  const textModels = models.filter((m) => m.capability === "text" && !/fish[-_ ]?audio/i.test(m.model));
  return Response.json({ models, slots: { thinking: textModels, chat: textModels, audio: [{ id: "openrouter-fish/fish-audio/s2.1-pro", provider: "openrouter-fish", model: "fish-audio/s2.1-pro", tier: "tts", capability: "audio", supportsTools: false, free: false, configured: Boolean(process.env.OPENROUTER_API_KEY || settings.openrouterKey), label: "OpenRouter · Fish Audio S2.1 Pro" }] } });
}

export function OPTIONS() {
  return new Response(null, { status: 204 });
}
