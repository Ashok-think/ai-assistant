/**
 * CLIENT ACTION PROTOCOL
 *
 * Some things an assistant is asked to do cannot happen on the server: opening a tab, reading
 * the screen, putting text on the clipboard. The server decides *what* should happen and hands
 * the browser a typed ClientAction; the browser performs it and reports back.
 *
 * This replaces the old `ACTION:OPEN_URL:<url>` string, which nothing ever parsed — so every
 * "open YouTube" silently did nothing but print the sentinel into the chat.
 */

export type ClientAction =
  | { kind: "open_url"; url: string; label: string }
  | { kind: "youtube_search"; query: string; label: string }
  | { kind: "compose_message"; app: MessageApp; to: string; text: string; url: string; label: string }
  | { kind: "capture_screen"; question: string; label: string }
  | { kind: "clipboard"; text: string; label: string }
  | { kind: "download_artifact"; title: string; format: "md" | "txt" | "xlsx" | "pdf"; content: string; label: string };

export type MessageApp = "whatsapp" | "sms" | "email" | "telegram" | "slack";

/** Result the browser sends back after performing an action, so the model can verify its work. */
export type ActionOutcome = { id: string; ok: boolean; detail: string };

/**
 * Hosts the assistant may navigate to without an explicit confirmation. Anything else still
 * works, but the UI asks first — an unauthenticated local server should not be able to send a
 * browser anywhere it likes just because a model emitted a URL.
 */
export const ALLOWED_HOSTS = [
  "google.com", "www.google.com", "youtube.com", "www.youtube.com", "youtu.be",
  "wikipedia.org", "en.wikipedia.org", "duckduckgo.com", "github.com", "stackoverflow.com",
  "web.whatsapp.com", "wa.me", "api.whatsapp.com", "mail.google.com", "gmail.com",
  "web.telegram.org", "t.me", "maps.google.com", "translate.google.com", "drive.google.com",
  "open.spotify.com", "netflix.com", "www.netflix.com", "x.com", "twitter.com",
  "linkedin.com", "www.linkedin.com", "reddit.com", "www.reddit.com", "chatgpt.com",
];

/** true when the URL is http(s) and its host is on the allowlist (or a subdomain of one). */
export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Accepts "youtube.com", "open youtube", "https://x.com/y" and returns a real URL. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim().replace(/^["'<]|[">']$/g, "");
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Common site shortcuts, so "open youtube" doesn't need a full URL from the model. */
export const SITE_SHORTCUTS: Record<string, string> = {
  youtube: "https://www.youtube.com", yt: "https://www.youtube.com",
  google: "https://www.google.com", gmail: "https://mail.google.com",
  whatsapp: "https://web.whatsapp.com", telegram: "https://web.telegram.org",
  maps: "https://maps.google.com", drive: "https://drive.google.com",
  spotify: "https://open.spotify.com", netflix: "https://www.netflix.com",
  github: "https://github.com", reddit: "https://www.reddit.com",
  wikipedia: "https://en.wikipedia.org", twitter: "https://x.com", x: "https://x.com",
  linkedin: "https://www.linkedin.com", chatgpt: "https://chatgpt.com",
  translate: "https://translate.google.com", instagram: "https://www.instagram.com",
};

/** Strip everything but digits and a leading +, so "+91 98765 43210" → "919876543210". */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

/**
 * Deep link that opens a messaging app with the recipient and text already filled in.
 * The send button stays with the user — a prefilled draft is the furthest a web page can go
 * without driving a real browser session (that is what the Playwright engine is for).
 */
export function composeUrl(app: MessageApp, to: string, text: string): string {
  const body = encodeURIComponent(text);
  switch (app) {
    case "whatsapp": {
      const phone = normalizePhone(to);
      return phone ? `https://wa.me/${phone}?text=${body}` : `https://web.whatsapp.com/send?text=${body}`;
    }
    case "sms":
      return `sms:${to.replace(/\s/g, "")}${to ? "?" : ""}body=${body}`;
    case "email": {
      const subject = encodeURIComponent(text.split("\n")[0].slice(0, 60) || "Hello");
      return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${subject}&body=${body}`;
    }
    case "telegram":
      return to ? `https://t.me/${to.replace(/^@/, "")}` : "https://web.telegram.org";
    case "slack":
      return "https://app.slack.com/client";
  }
}

