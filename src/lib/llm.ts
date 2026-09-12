import type { ModelSpec } from "./router";
import { gatewayCompletion } from "./gateway";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type LLMResult = {
  content: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
};

export type LLMErrorKind =
  | "quota_exhausted" // hard: daily/project quota gone — do NOT retry
  | "rate_limited" // soft: per-minute RPM/TPM — brief backoff can help
  | "auth" | "server" | "bad_request" | "network" | "unknown";

/** A typed provider error so the UI can say "Gemini limit reached" instead of "Gemini failed". */
export class LLMError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly kind: LLMErrorKind,
    readonly rawSnippet: string,
    readonly retryable: boolean,
  ) {
    super(`${provider} ${status} ${kind}`);
    this.name = "LLMError";
  }
}

/** Classify an HTTP error body from an OpenAI-compatible / Gemini endpoint. */
export function classifyLLMError(provider: string, status: number, body: string): LLMError {
  const low = body.toLowerCase();
  const mentionsQuota = /quota|resource_exhausted|billing|exceeded your current quota|insufficient|credit/.test(low);
  const perDay = /per day|daily|requests per day|free_tier.*day/.test(low);
  const perMinute = /per minute|rpm|tpm|tokens per minute|requests per minute|rate limit/.test(low);
  if (status === 429 || mentionsQuota) {
    // Distinguish a hard quota (stop) from a per-minute rate limit (short backoff).
    if (perDay || (mentionsQuota && !perMinute)) return new LLMError(provider, status, "quota_exhausted", body.slice(0, 200), false);
    return new LLMError(provider, status, "rate_limited", body.slice(0, 200), true);
  }
  if (status === 401 || status === 403) return new LLMError(provider, status, "auth", body.slice(0, 200), false);
  if (status === 400 || status === 404 || status === 422) return new LLMError(provider, status, "bad_request", body.slice(0, 200), false);
  if (status >= 500) return new LLMError(provider, status, "server", body.slice(0, 200), true);
  return new LLMError(provider, status, "unknown", body.slice(0, 200), false);
}

/** Human-readable, specific message for the UI. Never invents remaining credits. */
export function llmErrorMessage(e: LLMError): string {
  switch (e.kind) {
    case "quota_exhausted":
      return `${cap(e.provider)} limit reached — the account quota is exhausted for now (the API reported quota/resource-exhausted). Try again later or check billing/limits.`;
    case "rate_limited":
      return `${cap(e.provider)} rate limit reached — too many requests per minute. Slowing down and retrying.`;
    case "auth":
      return `${cap(e.provider)} authentication failed (status ${e.status}). Check the API key.`;
    case "server":
      return `${cap(e.provider)} had a server error (${e.status}). Retrying briefly.`;
    case "bad_request":
      return `${cap(e.provider)} rejected the request (${e.status}).`;
    default:
      return `${cap(e.provider)} error (${e.status}).`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Shared request shape for both the buffered and streaming paths. */
function buildRequest(opts: {
  spec: ModelSpec;
  apiKey: string | null;
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Gemini's OpenAI-compatible endpoint uses Bearer auth
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  if (opts.spec.provider === "openrouter" || opts.spec.provider === "tokenrouter") {
    headers["HTTP-Referer"] = "https://jarvish-ai.local";
    headers["X-Title"] = "Jarvish AI Agent";
  }
  const body: Record<string, unknown> = {
    model: opts.spec.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 900,
  };
  if (opts.tools && opts.tools.length && opts.spec.supportsTools) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.stream) body.stream = true;
  return { url: `${opts.spec.baseUrl}/chat/completions`, headers, body };
}

/**
 * Streaming completion. Tokens are yielded as they arrive, which is the difference between a reply
 * that feels instant and one that appears all at once after several seconds.
 *
 * Tool calls stream as fragments (`arguments` arrives a few characters at a time, keyed by index),
 * so they are reassembled here and handed back whole in the final `done` event.
 */
export async function* chatCompletionStream(opts: {
  spec: ModelSpec;
  apiKey: string | null;
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Give up if the provider accepts the request and then goes quiet. A provider that is up but
   * stalled is the slowest possible failure — worse than one that refuses outright — so it gets a
   * much shorter leash than the overall timeout.
   */
  firstTokenTimeoutMs?: number;
}): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; result: LLMResult }> {
  if (opts.spec.provider === "gateway") {
    yield* gatewayCompletion(opts);
    return;
  }
  const { url, headers, body } = buildRequest({ ...opts, stream: true });
  const ctl = new AbortController();
  let ttft: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (ttft) clearTimeout(ttft);
    ttft = null;
  };
  if (opts.firstTokenTimeoutMs) {
    ttft = setTimeout(
      () => ctl.abort(new Error(`${opts.spec.provider} sent nothing for ${opts.firstTokenTimeoutMs}ms`)),
      opts.firstTokenTimeoutMs,
    );
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(opts.timeoutMs ?? 60000)]),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw classifyLLMError(opts.spec.provider, res.status, txt);
    }
    if (!res.body) throw new Error(`${opts.spec.provider} returned no stream`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let content = "";
    let tokensIn = 0;
    let tokensOut = 0;
    const partial = new Map<number, { id: string; name: string; args: string }>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let j: {
          choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          j = JSON.parse(payload);
        } catch {
          continue; // a keep-alive comment or a split frame we'll see again next chunk
        }
        disarm(); // real data arrived, so the provider is alive
        if (j.usage) {
          tokensIn = j.usage.prompt_tokens ?? tokensIn;
          tokensOut = j.usage.completion_tokens ?? tokensOut;
        }
        const d = j.choices?.[0]?.delta;
        if (!d) continue;
        if (d.content) {
          content += d.content;
          yield { type: "delta", text: d.content };
        }
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const cur = partial.get(i) ?? { id: "", name: "", args: "" };
          partial.set(i, {
            id: tc.id ?? cur.id,
            name: tc.function?.name ?? cur.name,
            args: cur.args + (tc.function?.arguments ?? ""),
          });
        }
      }
    }

    const toolCalls: ToolCall[] = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, v]) => v.name)
      .map(([i, v]) => ({ id: v.id || `call_${i}`, type: "function" as const, function: { name: v.name, arguments: v.args || "{}" } }));

    yield {
      type: "done",
      result: {
        content,
        toolCalls,
        // Not every provider sends usage on streamed responses; estimate so the budget still moves.
        tokensIn: tokensIn || Math.ceil(JSON.stringify(opts.messages).length / 4),
        tokensOut: tokensOut || Math.ceil(content.length / 4),
      },
    };
  } finally {
    disarm();
  }
}

export async function chatCompletion(opts: {
  spec: ModelSpec;
  apiKey: string | null;
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<LLMResult> {
  if (opts.spec.provider === "gateway") {
    for await (const event of gatewayCompletion(opts)) {
      if (event.type === "done") return event.result;
    }
    throw new Error("Gateway returned no completion");
  }
  const { url, headers, body } = buildRequest(opts);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw classifyLLMError(opts.spec.provider, res.status, txt);
  }
  const j = (await res.json()) as {
    choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = j.choices?.[0]?.message;
  return {
    content: msg?.content ?? "",
    toolCalls: msg?.tool_calls ?? [],
    tokensIn: j.usage?.prompt_tokens ?? 0,
    tokensOut: j.usage?.completion_tokens ?? 0,
  };
}
