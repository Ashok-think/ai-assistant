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
  const capabilities = [
    { key: "chat", label: "Chat and planning", ready: true, detail: "Available in the web workspace" },
    { key: "research", label: "Web research", ready: true, detail: "Search and source collection enabled" },
    { key: "browser", label: "Browser actions", ready: true, detail: "Actions require browser confirmation" },
    { key: "exports", label: "Document and spreadsheet exports", ready: true, detail: "Markdown, text, PDF, and XLSX" },
    { key: "vision", label: "Vision analysis", ready: Boolean(configured.gemini), detail: configured.gemini ? "Gemini vision is configured" : "Add Gemini to enable image analysis" },
    { key: "device", label: "Windows device control", ready: configured.companion, detail: "Install and pair the Windows companion" },
    { key: "tts", label: "Voice replies", ready: Object.values(configured).some(Boolean), detail: "Premium providers fall back to browser speech" },
  ];
  return Response.json({ capabilities, providers: configured, ttsPolicies: policies, recentTtsMetrics: getRecentTtsMetrics(), tools: TOOLS.map((tool) => ({ name: tool.name, skillKey: tool.skillKey, requiresConfirmation: Boolean(tool.requiresConfirmation) })) });
}
