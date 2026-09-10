/**
 * SPEECH / DISPLAY TEXT SANITIZERS
 * --------------------------------
 * One place that turns a raw assistant response into two clean representations:
 *
 *   toDisplayText(raw)  → what the UI shows (keeps intended code blocks, drops internal markers)
 *   toSpeechText(raw)   → what TTS reads (natural spoken language; never tags/JSON/tool traces/
 *                         markdown symbols/code fences)
 *
 * The goal: the character must never SAY "<search_results>", raw JSON, tool-call structures,
 * "asterisk", "hash", or read code fences aloud — while legitimately-requested code still shows
 * in the chat bubble.
 */

/**
 * TRANSCRIPT CORRECTION (STT → text)
 * ----------------------------------
 * A LIGHT, high-confidence pass over a speech transcript before it goes to the model. It only
 * fixes brand names that speech recognizers routinely mangle, and normalizes spacing. It does NOT
 * rewrite meaning, and it preserves names/urls/code. Anything ambiguous is left untouched — the
 * LLM is far better at intent than a regex, so we stay conservative on purpose.
 */
const BRAND_FIXES: [RegExp, string][] = [
  [/\b(you ?tube|u ?tube|yout ?ube|youtub)\b/gi, "YouTube"],
  [/\b(chat ?g ?p ?t|chat gpt|chatgtp|chat gbt|chatgbt)\b/gi, "ChatGPT"],
  [/\b(gemini|gemni|jemini|gemeni)\b/gi, "Gemini"],
  [/\b(open ?a ?i|openai)\b/gi, "OpenAI"],
  [/\b(whats ?app|whatsup|whats up app)\b/gi, "WhatsApp"],
  [/\b(git ?hub|git hub)\b/gi, "GitHub"],
  [/\b(google|googel|gugal)\b/gi, "Google"],
  [/\b(spotify|spotifi)\b/gi, "Spotify"],
  [/\b(gmail|g mail|jmail)\b/gi, "Gmail"],
  [/\b(instagram|insta gram)\b/gi, "Instagram"],
];

export function correctTranscript(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  for (const [re, to] of BRAND_FIXES) s = s.replace(re, to);
  // Common Telugu/Hindi transliteration where recognizers drop it: keep the user's word, just tidy.
  s = s.replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1");
  return s;
}

/** Emotion markers the model emits, e.g. [happy], [excited]. */
const EMOTION_TAG = /\[(?:happy|excited|laughing|sad|angry|surprised|confused|calm|shy|sleepy|neutral|thinking|serious)\]/gi;

/** Remove code fences entirely (content + fence). */
function stripCodeFences(s: string): string {
  return s.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
}

/** Remove inline `code` spans, keeping the inner text. */
function stripInlineCode(s: string): string {
  return s.replace(/`([^`]+)`/g, "$1");
}

/** Remove XML/HTML-ish tags and common tool/metadata wrappers. */
function stripTags(s: string): string {
  return s
    // <tool_call>...</tool_call>, <search_results>...</search_results>, etc.
    .replace(/<([a-z_][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // any remaining self-closing or stray tags
    .replace(/<\/?[a-z_][\w-]*\b[^>]*>/gi, " ");
}

/** Remove obvious standalone JSON / tool-call objects that leaked into prose. */
function stripJsonBlobs(s: string): string {
  return s
    // {"name":"tool", "arguments": {...}} style blobs
    .replace(/\{[^{}]*"(?:name|tool|arguments|tool_call|function)"[^{}]*\}/gi, " ")
    // a line that is basically just a JSON object/array
    .replace(/^\s*[[{][\s\S]{0,400}?[\]}]\s*$/gm, " ");
}

/** Remove debug/metadata markers like [tool: x], (source: ...), 【...】citations. */
function stripMeta(s: string): string {
  return s
    .replace(/\[(?:tool|debug|trace|meta|status|action)\b[^\]]*\]/gi, " ")
    .replace(/【[^】]*】/g, " ")
    .replace(/\[\^?\d+\]/g, " "); // [1] [^2] footnote/citation markers
}

/** Collapse whitespace and tidy stray punctuation left by removals. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n{3,}/g, "\n\n")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,!?;:]){2,}/g, "$1")
    .trim();
}

/**
 * Display text: clean for the chat bubble. Keeps code blocks and normal markdown (the UI renders
 * them), but strips internal machine markers the user should never see.
 */
export function toDisplayText(raw: string): string {
  if (!raw) return "";
  let s = raw;
  s = stripTags(s);
  s = stripJsonBlobs(s);
  s = stripMeta(s);
  s = s.replace(EMOTION_TAG, " ");
  return tidy(s);
}

/**
 * Speech text: natural spoken language. Removes everything a voice must not read — code fences,
 * tags, JSON, tool traces, markdown symbols, urls, emotion tags — and converts a few symbols to
 * spoken-friendly forms. Never reads "asterisk"/"hash" etc.
 */
export function toSpeechText(raw: string): string {
  if (!raw) return "";
  let s = raw;
  s = stripCodeFences(s);
  s = stripTags(s);
  s = stripJsonBlobs(s);
  s = stripMeta(s);
  s = s.replace(EMOTION_TAG, " ");
  s = stripInlineCode(s);
  // Markdown headings / list bullets → drop the symbols, keep the words.
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  // Bold/italic/strikethrough markers.
  s = s.replace(/(\*\*|\*|__|_|~~)(.*?)\1/g, "$2");
  // Links [text](url) → just the text; bare urls → dropped.
  s = s.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1");
  s = s.replace(/\bhttps?:\/\/\S+/gi, " ");
  // Leftover lone markdown symbols that would otherwise be voiced.
  s = s.replace(/[*_`#>|]/g, " ");
  return tidy(s).slice(0, 1500);
}
