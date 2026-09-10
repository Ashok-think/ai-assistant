package com.nova.companion.router

import android.util.Log
import com.nova.companion.config.Config
import com.nova.companion.config.RouterProfile
import com.nova.companion.config.ToolDef
import com.nova.companion.config.substituteEnv
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class ChatMessage(val role: String, val content: String)
data class ToolCall(val name: String, val arguments: JsonObject)
data class CallLog(val ts: Long, val profile: String, val model: String, val ms: Long, val ok: Boolean,
                   val tokensIn: Int, val tokensOut: Int, val costUsd: Double, val error: String? = null)
data class Health(val ok: Boolean, val ms: Long, val at: Long, val error: String? = null)

sealed class StreamEvent {
    data class Meta(val profile: String, val model: String) : StreamEvent()
    data class Delta(val text: String) : StreamEvent()
    data class Tool(val call: ToolCall) : StreamEvent()
    data class Done(val log: CallLog) : StreamEvent()
}

/**
 * Reads the active profile from Config, injects the right headers, streams SSE,
 * and walks the fallback chain: active → OpenRouter free list → paid → Gemini Flash → local.
 */
class LLMRouter(private val cfg: Config, private val env: Map<String, String>) {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build()
    val calls = ArrayDeque<CallLog>()
    val health = mutableMapOf<String, Health>()

    companion object {
        const val OFFLINE_REPLY = "<emo=sad> I'm having trouble reaching my brain right now. Try switching routers in Settings?"
        private const val TAG = "LLMRouter"
    }

    private fun key(p: RouterProfile) = p.apiKey.ifBlank { env[p.apiKeyEnv] ?: "" }

    private fun headers(p: RouterProfile): Map<String, String> = buildMap {
        put("Content-Type", "application/json")
        p.headers.forEach { (k, v) -> v.substituteEnv(env).takeIf { it.isNotBlank() }?.let { put(k, it) } }
        val k = key(p)
        when (p.provider) {
            "gemini" -> if (k.isNotBlank()) put("x-goog-api-key", k)
            else -> if (k.isNotBlank()) put("Authorization", "Bearer $k")
        }
        if (p.provider == "openrouter") { putIfAbsent("HTTP-Referer", "https://yourapp.com"); putIfAbsent("X-Title", "Nova Companion") }
    }

    private fun url(p: RouterProfile, model: String, stream: Boolean): String {
        var u = p.baseUrl.substituteEnv(env).replace("{model_id}", model)
        if (p.provider == "gemini") {
            u = u.replace(":generateContent", if (stream) ":streamGenerateContent" else ":generateContent")
            if (stream) u += (if ('?' in u) "&" else "?") + "alt=sse"
        }
        return u
    }

    private fun body(p: RouterProfile, model: String, msgs: List<ChatMessage>, tools: List<ToolDef>, stream: Boolean, maxTokens: Int = p.maxTokens): String {
        if (p.provider == "gemini") {
            val sys = msgs.filter { it.role == "system" }.joinToString("\n") { it.content }
            return buildJsonObject {
                putJsonArray("contents") { msgs.filter { it.role != "system" }.forEach { m ->
                    addJsonObject { put("role", if (m.role == "assistant") "model" else "user"); putJsonArray("parts") { addJsonObject { put("text", m.content) } } } } }
                putJsonObject("generationConfig") { put("temperature", p.temperature); put("maxOutputTokens", maxTokens) }
                if (sys.isNotBlank()) putJsonObject("systemInstruction") { putJsonArray("parts") { addJsonObject { put("text", sys) } } }
                if (tools.isNotEmpty()) putJsonArray("tools") { addJsonObject { putJsonArray("functionDeclarations") { tools.forEach { t ->
                    addJsonObject { put("name", t.name); put("description", t.description); put("parameters", t.parameters) } } } } }
            }.toString()
        }
        return buildJsonObject {
            put("model", model); put("temperature", p.temperature); put("max_tokens", maxTokens); put("stream", stream)
            putJsonArray("messages") { msgs.forEach { m -> addJsonObject { put("role", m.role); put("content", m.content) } } }
            if (tools.isNotEmpty()) putJsonArray("tools") { tools.forEach { t -> addJsonObject { put("type", "function")
                putJsonObject("function") { put("name", t.name); put("description", t.description); put("parameters", t.parameters) } } } }
        }.toString()
    }

    /** 1-token ping; must return 200 within pingTimeoutMs. */
    suspend fun ping(p: RouterProfile, model: String = p.modelIds.firstOrNull() ?: ""): Health {
        if (p.baseUrl.isBlank() || model.isBlank()) return Health(false, 0, System.currentTimeMillis(), "not configured").also { health[p.id] = it }
        val t0 = System.currentTimeMillis()
        val h = withTimeoutOrNull(cfg.llmRouter.pingTimeoutMs) {
            runCatching {
                val req = Request.Builder().url(url(p, model, false)).apply { headers(p).forEach { (k, v) -> header(k, v) } }
                    .post(body(p, model, listOf(ChatMessage("user", "ping")), emptyList(), false, 1).toRequestBody("application/json".toMediaType())).build()
                http.newCall(req).execute().use { r -> Health(r.isSuccessful, System.currentTimeMillis() - t0, System.currentTimeMillis(), if (r.isSuccessful) null else "HTTP ${r.code}") }
            }.getOrElse { Health(false, System.currentTimeMillis() - t0, System.currentTimeMillis(), it.message) }
        } ?: Health(false, cfg.llmRouter.pingTimeoutMs, System.currentTimeMillis(), "timeout")
        health[p.id] = h; return h
    }

    suspend fun pingAll(): Map<String, Health> { cfg.llmRouter.profiles.forEach { ping(it) }; return health }

    private data class Candidate(val p: RouterProfile, val model: String, val paid: Boolean = false)

    private fun candidates(): List<Candidate> {
        val out = mutableListOf<Candidate>()
        fun push(p: RouterProfile?, model: String, paid: Boolean = false) {
            if (p != null && p.baseUrl.isNotBlank() && model.isNotBlank() && out.none { it.p.id == p.id && it.model == model }) out += Candidate(p, model, paid)
        }
        val active = cfg.activeProfile()
        push(active, active.modelIds.firstOrNull() ?: "")
        cfg.llmRouter.profiles.firstOrNull { it.id == "openrouter_free" }?.takeIf { key(it).isNotBlank() }?.let { or -> or.modelIds.forEach { push(or, it) } }
        push(active, active.paidModelId, paid = true)
        cfg.llmRouter.profiles.firstOrNull { it.id == cfg.llmRouter.fallbackModel.profileId }?.let { push(it, cfg.llmRouter.fallbackModel.modelId) }
        cfg.llmRouter.profiles.firstOrNull { it.id == "local_ollama" }?.let { push(it, it.modelIds.first()) }
        return out.filter { it.p.id == "local_ollama" || it.p.apiKeyEnv.isBlank() || key(it.p).isNotBlank() }
    }

    /** Streams deltas + tool calls. Falls through the chain on 429/401/empty. */
    fun chat(messages: List<ChatMessage>, tools: List<ToolDef> = cfg.tools): Flow<StreamEvent> = flow {
        val promptTokens = messages.sumOf { it.content.length } / 4
        val chain = candidates()
        if (chain.isEmpty()) { emit(StreamEvent.Meta("none", "none")); emit(StreamEvent.Delta(OFFLINE_REPLY)); emit(StreamEvent.Done(record("none", "none", 0, false, promptTokens, 0, "no provider"))); return@flow }

        for (c in chain) {
            val t0 = System.currentTimeMillis()
            val req = Request.Builder().url(url(c.p, c.model, true)).apply { headers(c.p).forEach { (k, v) -> header(k, v) } }
                .post(body(c.p, c.model, messages, tools, true).toRequestBody("application/json".toMediaType())).build()
            val resp = runCatching { http.newCall(req).execute() }.getOrElse { record(c.p.id, c.model, System.currentTimeMillis() - t0, false, promptTokens, 0, it.message); continue }
            if (!resp.isSuccessful) { resp.close(); Log.w(TAG, "${c.p.name}/${c.model} -> ${resp.code}, falling back"); record(c.p.id, c.model, System.currentTimeMillis() - t0, false, promptTokens, 0, "HTTP ${resp.code}"); kotlinx.coroutines.delay(500); continue }

            emit(StreamEvent.Meta(c.p.id, c.model))
            val out = StringBuilder(); val toolBuf = mutableMapOf<Int, Pair<String, StringBuilder>>()
            resp.body!!.source().use { src ->
                while (!src.exhausted()) {
                    val line = src.readUtf8Line() ?: break
                    if (!line.startsWith("data:")) continue
                    val data = line.removePrefix("data:").trim(); if (data == "[DONE]") break
                    val j = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: continue
                    if (c.p.provider == "gemini") {
                        j["candidates"]?.jsonArray?.firstOrNull()?.jsonObject?.get("content")?.jsonObject?.get("parts")?.jsonArray?.forEach { part ->
                            part.jsonObject["text"]?.jsonPrimitive?.contentOrNull?.let { out.append(it); emit(StreamEvent.Delta(it)) }
                            part.jsonObject["functionCall"]?.jsonObject?.let { fc -> emit(StreamEvent.Tool(ToolCall(fc["name"]!!.jsonPrimitive.content, fc["args"]?.jsonObject ?: JsonObject(emptyMap())))) }
                        }
                    } else {
                        val d = j["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("delta")?.jsonObject
                        d?.get("content")?.jsonPrimitive?.contentOrNull?.let { out.append(it); emit(StreamEvent.Delta(it)) }
                        d?.get("tool_calls")?.jsonArray?.forEach { tc ->
                            val idx = tc.jsonObject["index"]?.jsonPrimitive?.intOrNull ?: 0
                            val fn = tc.jsonObject["function"]?.jsonObject
                            val slot = toolBuf.getOrPut(idx) { "" to StringBuilder() }
                            val name = fn?.get("name")?.jsonPrimitive?.contentOrNull ?: slot.first
                            fn?.get("arguments")?.jsonPrimitive?.contentOrNull?.let { slot.second.append(it) }
                            toolBuf[idx] = name to slot.second
                        }
                    }
                }
            }
            toolBuf.values.forEach { (name, args) -> emit(StreamEvent.Tool(ToolCall(name, runCatching { json.parseToJsonElement(args.toString()).jsonObject }.getOrDefault(JsonObject(emptyMap()))))) }
            if (out.isBlank() && toolBuf.isEmpty()) { record(c.p.id, c.model, System.currentTimeMillis() - t0, false, promptTokens, 0, "empty"); continue }
            val log = record(c.p.id, c.model, System.currentTimeMillis() - t0, true, promptTokens, out.length / 4, null, c.paid)
            Log.i(TAG, "served by ${c.p.name}/${c.model} ${log.ms}ms $${"%.5f".format(log.costUsd)}")
            emit(StreamEvent.Done(log)); return@flow
        }
        emit(StreamEvent.Meta("none", "none")); emit(StreamEvent.Delta(OFFLINE_REPLY))
        emit(StreamEvent.Done(record("none", "none", 0, false, promptTokens, 0, "all providers failed")))
    }.flowOn(Dispatchers.IO)

    private fun record(profile: String, model: String, ms: Long, ok: Boolean, tIn: Int, tOut: Int, error: String? = null, paid: Boolean = false): CallLog {
        val price = cfg.llmRouter.pricingPer1MTokens[model]
        val cost = if (price != null && (paid || !model.endsWith(":free"))) (tIn * price.input + tOut * price.out) / 1_000_000 else 0.0
        return CallLog(System.currentTimeMillis(), profile, model, ms, ok, tIn, tOut, cost, error).also { calls.addLast(it); if (calls.size > 200) calls.removeFirst() }
    }
}
