import "server-only";
import type { Browser, BrowserContext, Page } from "playwright";

/**
 * PC BROWSER EXECUTOR (Playwright / Chromium)
 * -------------------------------------------
 * The real "hands" for browser control on the PC. A single persistent Chromium context with one
 * active page. Every method returns a structured {ok, ...} result and NEVER throws to the caller,
 * so the agent always gets a real success/failure it can verify and report honestly.
 *
 * Security:
 *  - Runs server-side only (never in the browser bundle).
 *  - Uses a dedicated persistent profile dir so authorised sessions/cookies survive, but this
 *    module NEVER reads or returns cookies, localStorage, passwords or other secrets to the model.
 *  - A domain allowlist gates navigation; off-list hosts are refused (caller can widen).
 *  - Single tab: popups are captured and their URL redirected into the main page.
 */

export type BrowserResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };

export type PageSnapshot = {
  url: string;
  title: string;
  /** Trimmed visible text (secrets like password fields are never included). */
  text: string;
  /** A few interactive elements the agent can target, with stable indexes. */
  links: { i: number; text: string; href: string }[];
};

export type ResultItem = { i: number; title: string; href: string };

const PROFILE_DIR = process.env.JARVISH_BROWSER_PROFILE || ".jarvish-browser-profile";

// Navigation allowlist. Off-list hosts are refused so a compromised model can't send the real
// browser anywhere. Widen deliberately as new integrations are added.
const ALLOWED_HOSTS = [
  "google.com", "www.google.com", "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
  "wikipedia.org", "en.wikipedia.org", "duckduckgo.com", "html.duckduckgo.com",
  "github.com", "gist.github.com", "stackoverflow.com",
  "mail.google.com", "drive.google.com", "docs.google.com", "maps.google.com", "translate.google.com",
  "news.google.com", "bing.com", "www.bing.com",
  // AI assistants + common sites the user opens by voice.
  "chatgpt.com", "chat.openai.com", "openai.com", "gemini.google.com", "perplexity.ai", "www.perplexity.ai",
  "x.com", "twitter.com", "reddit.com", "www.reddit.com", "linkedin.com", "www.linkedin.com",
  "open.spotify.com", "netflix.com", "www.netflix.com", "amazon.in", "www.amazon.in", "amazon.com", "www.amazon.com",
];

function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

type BrowserState = { browser: Browser | null; context: BrowserContext | null; page: Page | null };

// Persist across HMR/module reloads in dev so we don't leak Chromium processes.
const g = globalThis as unknown as { __jarvishBrowser?: BrowserState };
const state: BrowserState = g.__jarvishBrowser ?? (g.__jarvishBrowser = { browser: null, context: null, page: null });

let launching: Promise<Page> | null = null;

async function launch(): Promise<Page> {
  if (state.page && !state.page.isClosed()) return state.page;
  if (launching) return launching;
  launching = (async () => {
    // Dynamic import so the (large) Playwright dep is only loaded when the browser is actually used.
    const { chromium } = await import("playwright");
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: process.env.JARVISH_BROWSER_HEADLESS === "1",
      viewport: { width: 1280, height: 800 },
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    state.context = context;
    state.browser = context.browser();
    const page = context.pages()[0] ?? (await context.newPage());
    // Single-tab discipline: fold any popup back into the main page.
    context.on("page", async (p) => {
      if (p === page) return;
      try {
        await p.waitForLoadState("domcontentloaded", { timeout: 5000 });
        const u = p.url();
        await p.close();
        if (u && u !== "about:blank" && hostAllowed(u)) await page.goto(u).catch(() => {});
      } catch {
        await p.close().catch(() => {});
      }
    });
    state.page = page;
    return page;
  })();
  try {
    return await launching;
  } finally {
    launching = null;
  }
}

export async function isRunning(): Promise<boolean> {
  return Boolean(state.page && !state.page.isClosed());
}

export async function shutdown(): Promise<void> {
  try {
    await state.context?.close();
  } catch {
    /* ignore */
  }
  state.browser = null;
  state.context = null;
  state.page = null;
}

async function snapshot(page: Page): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const text = (
    await page.evaluate(() => {
      const t = document.body?.innerText ?? "";
      return t.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 4000);
    }).catch(() => "")
  ) as string;
  const links = (await page
    .evaluate(() => {
      const out: { i: number; text: string; href: string }[] = [];
      const els = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      let i = 0;
      for (const a of els) {
        const label = (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
        const href = a.href;
        if (!label || !href || href.startsWith("javascript:")) continue;
        out.push({ i: i++, text: label.slice(0, 120), href });
        if (out.length >= 40) break;
      }
      return out;
    })
    .catch(() => [])) as { i: number; text: string; href: string }[];
  return { url, title, text, links };
}

// ---------------------------------------------------------------------------------------------
// Public operations. Each is defensive and returns a structured result.
// ---------------------------------------------------------------------------------------------

export async function open(url: string): Promise<BrowserResult<PageSnapshot>> {
  if (!hostAllowed(url)) return { ok: false, error: `Navigation to ${url} is not on the allowlist.` };
  try {
    const page = await launch();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(600);
    return { ok: true, data: await snapshot(page) };
  } catch (e) {
    return { ok: false, error: `open failed: ${(e as Error).message}` };
  }
}

export async function read(): Promise<BrowserResult<PageSnapshot>> {
  try {
    const page = await launch();
    return { ok: true, data: await snapshot(page) };
  } catch (e) {
    return { ok: false, error: `read failed: ${(e as Error).message}` };
  }
}

export async function typeText(selector: string, text: string, submit = false): Promise<BrowserResult<PageSnapshot>> {
  try {
    const page = await launch();
    const el = page.locator(selector).first();
    await el.waitFor({ state: "visible", timeout: 10000 });
    await el.click();
    await el.fill(text);
    if (submit) {
      await el.press("Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    return { ok: true, data: await snapshot(page) };
  } catch (e) {
    return { ok: false, error: `type failed: ${(e as Error).message}` };
  }
}

export async function click(target: { selector?: string; text?: string; index?: number }): Promise<BrowserResult<PageSnapshot>> {
  try {
    const page = await launch();
    if (typeof target.index === "number") {
      const links = page.locator("a[href]");
      await links.nth(target.index).click({ timeout: 10000 });
    } else if (target.selector) {
      await page.locator(target.selector).first().click({ timeout: 10000 });
    } else if (target.text) {
      await page.getByText(target.text, { exact: false }).first().click({ timeout: 10000 });
    } else {
      return { ok: false, error: "click needs a selector, text or index" };
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    return { ok: true, data: await snapshot(page) };
  } catch (e) {
    return { ok: false, error: `click failed: ${(e as Error).message}` };
  }
}

export async function scroll(dir: "down" | "up" = "down", amount = 800): Promise<BrowserResult<PageSnapshot>> {
  try {
    const page = await launch();
    await page.mouse.wheel(0, dir === "down" ? amount : -amount);
    await page.waitForTimeout(400);
    return { ok: true, data: await snapshot(page) };
  } catch (e) {
    return { ok: false, error: `scroll failed: ${(e as Error).message}` };
  }
}

export async function back(): Promise<BrowserResult<PageSnapshot>> {
  try {
    const page = await launch();
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500);
    return { ok: true, data: await snapshot(page) };
  } catch (e) {
    return { ok: false, error: `back failed: ${(e as Error).message}` };
  }
}

export async function screenshot(): Promise<BrowserResult<{ dataUrl: string }>> {
  try {
    const page = await launch();
    const buf = await page.screenshot({ type: "jpeg", quality: 70 });
    return { ok: true, data: { dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}` } };
  } catch (e) {
    return { ok: false, error: `screenshot failed: ${(e as Error).message}` };
  }
}

/** Assert the page matches an expectation (title/url/text contains). Real verification. */
export async function verify(expect: { urlIncludes?: string; titleIncludes?: string; textIncludes?: string }): Promise<BrowserResult<{ matched: boolean; snapshot: PageSnapshot }>> {
  try {
    const page = await launch();
    const snap = await snapshot(page);
    const hay = { url: snap.url.toLowerCase(), title: snap.title.toLowerCase(), text: snap.text.toLowerCase() };
    let matched = true;
    if (expect.urlIncludes) matched &&= hay.url.includes(expect.urlIncludes.toLowerCase());
    if (expect.titleIncludes) matched &&= hay.title.includes(expect.titleIncludes.toLowerCase());
    if (expect.textIncludes) matched &&= hay.text.includes(expect.textIncludes.toLowerCase());
    return { ok: true, data: { matched, snapshot: snap } };
  } catch (e) {
    return { ok: false, error: `verify failed: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------------------------
// High-level workflows built on the primitives.
// ---------------------------------------------------------------------------------------------

/** Real Google search: navigate, read the organic result links. */
export async function googleSearch(query: string): Promise<BrowserResult<{ results: ResultItem[]; snapshot: PageSnapshot }>> {
  const r = await open(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
  if (!r.ok) return r;
  try {
    const page = await launch();
    const results = (await page
      .evaluate(() => {
        const out: { i: number; title: string; href: string }[] = [];
        let i = 0;
        for (const h of Array.from(document.querySelectorAll("a h3"))) {
          const a = h.closest("a") as HTMLAnchorElement | null;
          if (!a?.href) continue;
          out.push({ i: i++, title: (h.textContent || "").trim(), href: a.href });
          if (out.length >= 10) break;
        }
        return out;
      })
      .catch(() => [])) as ResultItem[];
    return { ok: true, data: { results, snapshot: r.data } };
  } catch (e) {
    return { ok: false, error: `googleSearch failed: ${(e as Error).message}` };
  }
}

/** Real YouTube search: navigate to results and read the video renderers. */
export async function youtubeSearch(query: string): Promise<BrowserResult<{ results: ResultItem[]; snapshot: PageSnapshot }>> {
  const r = await open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  if (!r.ok) return r;
  try {
    const page = await launch();
    await page.waitForSelector("a#video-title, ytd-video-renderer", { timeout: 12000 }).catch(() => {});
    const results = (await page
      .evaluate(() => {
        const out: { i: number; title: string; href: string }[] = [];
        let i = 0;
        const els = Array.from(document.querySelectorAll<HTMLAnchorElement>("a#video-title, a#video-title-link"));
        for (const a of els) {
          const title = (a.getAttribute("title") || a.textContent || "").trim();
          const href = a.href;
          if (!title || !href || !href.includes("/watch")) continue;
          out.push({ i: i++, title, href });
          if (out.length >= 12) break;
        }
        return out;
      })
      .catch(() => [])) as ResultItem[];
    return { ok: true, data: { results, snapshot: r.data } };
  } catch (e) {
    return { ok: false, error: `youtubeSearch failed: ${(e as Error).message}` };
  }
}

/** Open a specific YouTube watch URL and verify a video is actually playing/loaded. */
export async function youtubeOpen(href: string): Promise<BrowserResult<{ title: string; url: string; playing: boolean }>> {
  if (!hostAllowed(href)) return { ok: false, error: `${href} is not an allowed YouTube URL.` };
  try {
    const page = await launch();
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const info = (await page
      .evaluate(() => {
        const v = document.querySelector("video");
        const title = document.querySelector("h1.title, h1.ytd-watch-metadata, title")?.textContent?.trim() || document.title;
        return { title: title || "", playing: Boolean(v && !(v as HTMLVideoElement).paused && (v as HTMLVideoElement).currentTime >= 0), hasVideo: Boolean(v) };
      })
      .catch(() => ({ title: "", playing: false, hasVideo: false }))) as { title: string; playing: boolean; hasVideo: boolean };
    const onWatch = page.url().includes("/watch");
    if (!onWatch || !info.hasVideo) return { ok: false, error: "video page did not load" };
    return { ok: true, data: { title: info.title, url: page.url(), playing: info.playing } };
  } catch (e) {
    return { ok: false, error: `youtubeOpen failed: ${(e as Error).message}` };
  }
}

/** Toggle play/pause on the current YouTube video via the player API-ish keyboard shortcut. */
export async function youtubePlayPause(play: boolean): Promise<BrowserResult<{ playing: boolean }>> {
  try {
    const page = await launch();
    const state = (await page
      .evaluate((wantPlay) => {
        const v = document.querySelector("video") as HTMLVideoElement | null;
        if (!v) return { playing: false, ok: false };
        if (wantPlay && v.paused) v.play();
        if (!wantPlay && !v.paused) v.pause();
        return { playing: !v.paused, ok: true };
      }, play)
      .catch(() => ({ playing: false, ok: false }))) as { playing: boolean; ok: boolean };
    if (!state.ok) return { ok: false, error: "no video element on this page" };
    return { ok: true, data: { playing: state.playing } };
  } catch (e) {
    return { ok: false, error: `play/pause failed: ${(e as Error).message}` };
  }
}
