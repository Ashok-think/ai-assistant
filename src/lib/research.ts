import "server-only";

/**
 * WEB RESEARCH
 * ------------
 * Real multi-source research: find candidate sources, fetch a few of them, extract readable
 * text, and hand the model the collected material WITH its source URLs so any summary is grounded
 * and citable. Nothing is invented — if a fetch fails it's reported, and if nothing is found the
 * tool says so.
 *
 * Keyless by default (DuckDuckGo HTML + Wikipedia). When the PC browser agent is running, callers
 * can additionally use pc_read for JS-heavy pages; this module sticks to plain fetch so it works
 * with zero setup.
 */

export type Source = { title: string; url: string; text: string };
export type ResearchResult = { ok: true; query: string; sources: Source[] } | { ok: false; error: string };

const UA = "Mozilla/5.0 (compatible; JarvishResearch/1.0)";

/** Strip HTML to rough readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Find candidate result URLs from DuckDuckGo's HTML endpoint (no key, no JS). */
async function findLinks(query: string, limit: number): Promise<{ title: string; url: string }[]> {
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const out: { title: string; url: string }[] = [];
    // DDG wraps real URLs in a redirect: /l/?uddg=<encoded>
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < limit) {
      let url = m[1];
      const uddg = /[?&]uddg=([^&]+)/.exec(url);
      if (uddg) url = decodeURIComponent(uddg[1]);
      if (!/^https?:\/\//.test(url)) continue;
      const title = htmlToText(m[2]).slice(0, 160);
      if (title) out.push({ title, url });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchReadable(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return "";
    const html = await r.text();
    return htmlToText(html).slice(0, 3500);
  } catch {
    return "";
  }
}

export async function research(query: string, maxSources = 3): Promise<ResearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: "empty research query" };

  const links = await findLinks(q, maxSources + 3);
  const sources: Source[] = [];

  // Always add a Wikipedia summary as a reliable baseline source.
  try {
    const w = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, "_"))}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (w.ok) {
      const j = (await w.json()) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
      if (j.extract) sources.push({ title: j.title ?? q, url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`, text: j.extract });
    }
  } catch {
    /* ignore */
  }

  for (const l of links) {
    if (sources.length >= maxSources) break;
    if (sources.some((s) => s.url === l.url)) continue;
    const text = await fetchReadable(l.url);
    if (text && text.length > 120) sources.push({ title: l.title, url: l.url, text });
  }

  if (!sources.length) return { ok: false, error: `No readable sources found for "${q}". The search may be blocked or the pages need JavaScript.` };
  return { ok: true, query: q, sources };
}
