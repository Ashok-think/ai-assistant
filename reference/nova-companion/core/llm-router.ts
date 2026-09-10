import type { AppConfig, Env, RouterProfile, ToolDef } from './config'
import { getProfile, profileKey, resolveHeaders, substituteEnv } from './config'

export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }
export interface ToolCall { name: string; arguments: Record<string, unknown> }

export interface CallLog {
  ts: string; profile: string; model: string; ms: number; ok: boolean
  tokensIn: number; tokensOut: number; costUsd: number; error?: string
}

export interface StreamEvent {
  type: 'meta' | 'delta' | 'tool_call' | 'done' | 'error'
  profile?: string; model?: string; text?: string; toolCall?: ToolCall; log?: CallLog; message?: string
}

const OFFLINE_REPLY = "<emo=sad> I'm having trouble reaching my brain right now. Try switching routers in Settings?"

function estimateTokens(s: string) { return Math.ceil(s.length / 4) }

export class LLMRouter {
  readonly calls: CallLog[] = []
  readonly health: Record<string, { ok: boolean; ms: number; at: string; error?: string }> = {}

  constructor(private cfg: AppConfig, private env: Env, private logger: Console = console) {}

  // ---- headers per provider -------------------------------------------------------------
  private headersFor(p: RouterProfile): Record<string, string> {
    const key = profileKey(p, this.env)
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...resolveHeaders(p.headers, this.env) }
    if (p.provider === 'gemini') { if (key) h['x-goog-api-key'] = key }
    else if (key) h['Authorization'] = `Bearer ${key}`
    if (p.provider === 'openrouter') { h['HTTP-Referer'] ??= 'https://yourapp.com'; h['X-Title'] ??= 'Nova Companion' }
    return h
  }

  private urlFor(p: RouterProfile, model: string, stream: boolean): string {
    let u = substituteEnv(p.baseUrl, this.env).replace('{model_id}', model)
    if (p.provider === 'gemini') {
      u = u.replace(':generateContent', stream ? ':streamGenerateContent' : ':generateContent')
      if (stream) u += (u.includes('?') ? '&' : '?') + 'alt=sse'
    }
    return u
  }

  private bodyFor(p: RouterProfile, model: string, messages: ChatMessage[], tools: ToolDef[], stream: boolean): string {
    if (p.provider === 'gemini') {
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }],
      }))
      const body: any = {
        contents, generationConfig: { temperature: p.temperature, maxOutputTokens: p.maxTokens },
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      }
      if (tools.length) body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
      return JSON.stringify(body)
    }
    const body: any = { model, messages, temperature: p.temperature, max_tokens: p.maxTokens, stream }
    if (tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    return JSON.stringify(body)
  }

  // ---- ping: 1-token request, must answer 200 in < pingTimeoutMs ------------------------
  async ping(p: RouterProfile, model = p.modelIds[0]): Promise<{ ok: boolean; ms: number; status?: number; error?: string }> {
    if (!p.baseUrl || !model) return { ok: false, ms: 0, error: 'not configured' }
    const t0 = Date.now()
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), this.cfg.llmRouter.pingTimeoutMs)
    try {
      const mini: RouterProfile = { ...p, maxTokens: 1, temperature: 0 }
      const r = await fetch(this.urlFor(p, model, false), {
        method: 'POST', headers: this.headersFor(p), signal: ctrl.signal,
        body: this.bodyFor(mini, model, [{ role: 'user', content: 'ping' }], [], false),
      })
      const ms = Date.now() - t0
      const res = { ok: r.ok, ms, status: r.status, ...(r.ok ? {} : { error: `HTTP ${r.status}` }) }
      this.health[p.id] = { ok: r.ok, ms, at: new Date().toISOString(), error: res.error }
      return res
    } catch (e) {
      const ms = Date.now() - t0; const error = (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message
      this.health[p.id] = { ok: false, ms, at: new Date().toISOString(), error }
      return { ok: false, ms, error }
    } finally { clearTimeout(timer) }
  }

  async pingAll() {
    await Promise.all(this.cfg.llmRouter.profiles.map(p => this.ping(p)))
    return this.health
  }

  // ---- candidate chain --------------------------------------------------------------------
  private candidates(): { p: RouterProfile; model: string; paid: boolean }[] {
    const cfg = this.cfg.llmRouter
    const active = getProfile(this.cfg)
    const out: { p: RouterProfile; model: string; paid: boolean }[] = []
    const push = (p: RouterProfile | undefined, model: string, paid = false) => {
      if (p && p.baseUrl && model && !out.some(c => c.p.id === p.id && c.model === model)) out.push({ p, model, paid })
    }
    // 1. active profile primary
    push(active, active.modelIds[0])
    // 2a. OpenRouter free list in order
    const or = cfg.profiles.find(p => p.id === 'openrouter_free')
    if (or && profileKey(or, this.env)) for (const m of or.modelIds) push(or, m)
    // 2b. paid model of the active profile
    push(active, active.paidModelId, true)
    // 2c. Gemini Flash (works on free tier with just GEMINI_API_KEY)
    const fb = cfg.profiles.find(p => p.id === cfg.fallbackModel.profileId)
    push(fb, cfg.fallbackModel.modelId)
    // 2d. local endpoints never need keys
    const local = cfg.profiles.find(p => p.id === 'local_ollama')
    if (local) push(local, local.modelIds[0])
    // skip candidates whose provider needs a key but has none
    return out.filter(c => c.p.provider === 'openai_compat' && !c.p.apiKeyEnv ? true : c.p.id === 'local_ollama' ? true : !!profileKey(c.p, this.env))
  }

  // ---- streaming chat: yields StreamEvents; caller turns them into SSE --------------------
  async *chat(messages: ChatMessage[], tools: ToolDef[] = []): AsyncGenerator<StreamEvent> {
    const chain = this.candidates()
    const promptTokens = estimateTokens(messages.map(m => m.content).join(' '))
    if (!chain.length) {
      yield { type: 'meta', profile: 'none', model: 'none' }
      yield { type: 'delta', text: OFFLINE_REPLY }
      yield { type: 'done', log: this.record('none', 'none', 0, false, promptTokens, 0, 'no configured provider') }
      return
    }

    for (const { p, model, paid } of chain) {
      const t0 = Date.now()
      let res: Response
      try {
        res = await fetch(this.urlFor(p, model, true), { method: 'POST', headers: this.headersFor(p), body: this.bodyFor(p, model, messages, tools, true) })
      } catch (e) {
        this.record(p.id, model, Date.now() - t0, false, promptTokens, 0, (e as Error).message); continue
      }
      if (!res.ok || !res.body) {
        this.logger.warn(`[llm] ${p.name}/${model} -> ${res.status}, falling back`)
        this.record(p.id, model, Date.now() - t0, false, promptTokens, 0, `HTTP ${res.status}`)
        await new Promise(r => setTimeout(r, 500)); continue
      }

      yield { type: 'meta', profile: p.id, model }
      let out = ''
      const toolBuf: Record<number, { name: string; args: string }> = {}
      for await (const data of sseLines(res.body)) {
        if (data === '[DONE]') break
        let j: any; try { j = JSON.parse(data) } catch { continue }
        if (p.provider === 'gemini') {
          for (const part of j.candidates?.[0]?.content?.parts ?? []) {
            if (part.text) { out += part.text; yield { type: 'delta', text: part.text } }
            if (part.functionCall) yield { type: 'tool_call', toolCall: { name: part.functionCall.name, arguments: part.functionCall.args ?? {} } }
          }
        } else {
          const d = j.choices?.[0]?.delta
          if (d?.content) { out += d.content; yield { type: 'delta', text: d.content } }
          for (const tc of d?.tool_calls ?? []) {
            const slot = toolBuf[tc.index ?? 0] ??= { name: '', args: '' }
            if (tc.function?.name) slot.name = tc.function.name
            if (tc.function?.arguments) slot.args += tc.function.arguments
          }
        }
      }
      for (const tc of Object.values(toolBuf)) {
        let args = {}; try { args = JSON.parse(tc.args || '{}') } catch {}
        yield { type: 'tool_call', toolCall: { name: tc.name, arguments: args } }
      }
      if (!out.trim() && !Object.keys(toolBuf).length) {
        this.record(p.id, model, Date.now() - t0, false, promptTokens, 0, 'empty'); continue
      }
      const outTok = estimateTokens(out)
      const log = this.record(p.id, model, Date.now() - t0, true, promptTokens, outTok, undefined, paid)
      this.logger.info(`[llm] served by ${p.name}/${model} ${log.ms}ms ~${outTok} tok $${log.costUsd.toFixed(5)}`)
      yield { type: 'done', log }
      return
    }

    yield { type: 'meta', profile: 'none', model: 'none' }
    yield { type: 'delta', text: OFFLINE_REPLY }
    yield { type: 'done', log: this.record('none', 'none', 0, false, promptTokens, 0, 'all providers failed') }
  }

  private record(profile: string, model: string, ms: number, ok: boolean, tokensIn: number, tokensOut: number, error?: string, paid = false): CallLog {
    const price = this.cfg.llmRouter.pricingPer1MTokens[model]
    const costUsd = price && (paid || !model.endsWith(':free')) ? (tokensIn * price.in + tokensOut * price.out) / 1_000_000 : 0
    const entry: CallLog = { ts: new Date().toISOString(), profile, model, ms, ok, tokensIn, tokensOut, costUsd, error }
    this.calls.push(entry); if (this.calls.length > 200) this.calls.shift()
    return entry
  }
}

// Parse text/event-stream body into "data:" payload strings.
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim()
}
