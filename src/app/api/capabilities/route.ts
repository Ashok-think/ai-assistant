import { getSettings } from "@/lib/bootstrap";
import { TOOLS } from "@/lib/tools";
import { getTtsPolicies, getRecentTtsMetrics } from "@/lib/tts-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  const policies = getTtsPolicies(settings.ttsPolicies);
  const configured = {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY || settings.openrouterKey),
    gemini: Boolean(process.env.GEMINI_API_KEY || settings.geminiKey),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY || settings.elevenLabsKey),
    browser: true,
    companion: false,
  };
  const state = (ready: boolean, detail: string, localOnly = false) => ({ status: ready ? "READY" : localOnly ? "LOCAL_ONLY" : "NEEDS_SETUP", ready, detail });
  const capabilities = [
    { key: "chat", label: "Chat and planning", ...state(true, "Available in the web workspace") },
    { key: "research", label: "Web research", ...state(true, "Search and source collection enabled") },
    { key: "browser", label: "Browser actions", ...state(true, "Actions require browser confirmation") },
    { key: "exports", label: "Document and spreadsheet exports", ...state(true, "Markdown, text, PDF, and XLSX") },
    { key: "vision", label: "Vision analysis", ...state(Boolean(configured.gemini), configured.gemini ? "Gemini vision is configured" : "Add Gemini to enable image analysis") },
    { key: "device", label: "Windows device control", ...state(configured.companion, configured.companion ? "Paired Windows companion" : "Install and pair the Windows companion") },
    { key: "tts", label: "Voice replies", ...state(true, "Browser speech is available locally", true) },
  ];
  const providerStatus = Object.fromEntries(Object.entries(configured).map(([provider, ready]) => [provider, { status: ready ? "READY" : provider === "browser" ? "LOCAL_ONLY" : "NEEDS_SETUP", configured: ready }]));
  return Response.json({ capabilities, providers: configured, providerStatus, ttsPolicies: policies, recentTtsMetrics: getRecentTtsMetrics(), tools: TOOLS.map((tool) => ({ name: tool.name, skillKey: tool.skillKey, requiresConfirmation: Boolean(tool.requiresConfirmation) })) });
}
