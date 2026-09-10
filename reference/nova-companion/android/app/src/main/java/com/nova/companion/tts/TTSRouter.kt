package com.nova.companion.tts

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.util.Log
import com.nova.companion.config.Character
import com.nova.companion.config.Config
import com.nova.companion.config.TtsParams
import com.nova.companion.config.substituteEnv
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

data class Parsed(val emotion: String, val text: String)
data class TtsResult(val provider: String, val voice: String, val emotion: String, val text: String, val ms: Long, val file: File?)

object Emotion {
    private val TAG_RE = Regex("""^\s*(?:<emo=([a-z]+)>|\[(?:emotion:\s*)?([a-z]+)])\s*""", RegexOption.IGNORE_CASE)
    private val ALL_TAGS = Regex("""<emo=[a-z]+>|\[(?:emotion:\s*)?[a-z]+]""", RegexOption.IGNORE_CASE)

    fun parse(raw: String, fallback: String, known: List<String>): Parsed {
        val m = TAG_RE.find(raw) ?: return Parsed(fallback, raw.trim())
        val tag = (m.groupValues[1].ifEmpty { m.groupValues[2] }).lowercase()
        return Parsed(if (tag in known) tag else fallback, raw.substring(m.range.last + 1).trim())
    }
    fun strip(text: String) = ALL_TAGS.replace(text, "").replace(Regex("\\s{2,}"), " ").trim()

    fun params(cfg: Config, ch: Character, emotion: String): TtsParams {
        val base = cfg.characterEngine.emotionToTts[emotion] ?: cfg.characterEngine.emotionToTts[ch.defaultEmotion]!!
        return TtsParams(
            (base.stability + ch.bias.stability).coerceIn(0.0, 1.0),
            (base.style + ch.bias.style).coerceIn(0.0, 1.0),
            (base.speed + ch.bias.speed).coerceIn(0.7, 1.2),
        )
    }
    fun geminiPrefix(cfg: Config, ch: Character, emotion: String): String {
        val how = cfg.characterEngine.geminiStyleByEmotion[emotion] ?: cfg.characterEngine.geminiStyleByEmotion[ch.defaultEmotion]
        return "You are ${ch.name}: ${ch.style} Say this $how:"
    }
}

/**
 * ElevenLabs → Gemini TTS → Edge → Kokoro → OpenAI, then Android's built-in TextToSpeech as last resort.
 * Drops to the next provider after 401/429/empty with a 0.5 s delay. Logs which provider served.
 */
class TTSRouter(private val ctx: Context, private val cfg: Config, private val env: Map<String, String>) {
    private val http = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).build()
    private val json = Json { ignoreUnknownKeys = true }
    private var elevenByName: Map<String, String>? = null
    private var systemTts: TextToSpeech? = null
    private var player: MediaPlayer? = null
    val log = ArrayDeque<String>()

    companion object { private const val TAG = "TTSRouter" }

    /** Call once on startup: GET /v1/voices and match by name; fall back to hard-coded id. */
    suspend fun warmUpElevenVoices() = withContext(Dispatchers.IO) {
        val prov = cfg.voiceRoutes.providers["elevenlabs"] ?: return@withContext
        val key = prov.headers["xi-api-key"]?.substituteEnv(env).orEmpty()
        if (key.isBlank()) { Log.i(TAG, "ElevenLabs: no key, skipping voice list"); return@withContext }
        runCatching {
            http.newCall(Request.Builder().url(prov.voicesUrl ?: "https://api.elevenlabs.io/v1/voices").header("xi-api-key", key).build()).execute().use { r ->
                if (!r.isSuccessful) { Log.w(TAG, "ElevenLabs /v1/voices -> ${r.code}"); return@use }
                elevenByName = json.parseToJsonElement(r.body!!.string()).jsonObject["voices"]!!.jsonArray
                    .associate { it.jsonObject["name"]!!.jsonPrimitive.content.lowercase() to it.jsonObject["voice_id"]!!.jsonPrimitive.content }
                Log.i(TAG, "ElevenLabs voices loaded: ${elevenByName!!.size}")
            }
        }.onFailure { Log.w(TAG, "ElevenLabs /v1/voices failed: ${it.message}") }
    }

    private fun elevenVoiceId(ch: Character, override: String?): String {
        override?.takeIf { it.isNotBlank() }?.let { Log.i(TAG, "ElevenLabs voice: user-pasted $it"); return it }
        cfg.voiceRoutes.providers["elevenlabs"]?.userPastedId?.takeIf { it.isNotBlank() }?.let { Log.i(TAG, "ElevenLabs voice: settings-pasted $it"); return it }
        elevenByName?.get(ch.voice.elevenlabs.name.lowercase())?.let { Log.i(TAG, "ElevenLabs voice '${ch.voice.elevenlabs.name}' matched by name -> $it"); return it }
        Log.i(TAG, "ElevenLabs voice '${ch.voice.elevenlabs.name}' not found by name, using hard-coded ${ch.voice.elevenlabs.id}")
        return ch.voice.elevenlabs.id
    }

    suspend fun speak(ch: Character, rawReply: String, forceProvider: String? = null, voiceOverride: String? = null): TtsResult = withContext(Dispatchers.IO) {
        val parsed = Emotion.parse(rawReply, ch.defaultEmotion, cfg.characterEngine.emotions)
        val text = Emotion.strip(parsed.text); val emotion = parsed.emotion
        val p = Emotion.params(cfg, ch, emotion)
        val order = forceProvider?.let { listOf(it) } ?: cfg.voiceRoutes.priority
        val started = System.currentTimeMillis()

        for (provider in order) {
            val prov = cfg.voiceRoutes.providers[provider] ?: continue
            val headers = prov.headers.mapValues { it.value.substituteEnv(env) }.filterValues { it.isNotBlank() && it != "Bearer " }
            val needsKey = provider in setOf("elevenlabs", "gemini_tts", "openai_tts")
            if (needsKey && headers.isEmpty()) { log("$provider skip: no key"); continue }

            val (url, body, voice) = when (provider) {
                "elevenlabs" -> { val v = elevenVoiceId(ch, voiceOverride); Triple(prov.baseUrl.replace("{voice_id}", v) + "?output_format=mp3_44100_128",
                    buildJsonObject { put("text", text); put("model_id", prov.model ?: "eleven_multilingual_v2")
                        putJsonObject("voice_settings") { put("stability", p.stability); put("style", p.style); put("speed", p.speed); put("similarity_boost", 0.8); put("use_speaker_boost", true) } }, v) }
                "gemini_tts" -> { val v = voiceOverride?.ifBlank { null } ?: ch.voice.gemini; Triple(prov.baseUrl,
                    buildJsonObject { putJsonArray("contents") { addJsonObject { putJsonArray("parts") { addJsonObject { put("text", "${Emotion.geminiPrefix(cfg, ch, emotion)} $text") } } } }
                        putJsonObject("generationConfig") { putJsonArray("responseModalities") { add("AUDIO") }
                            putJsonObject("speechConfig") { putJsonObject("voiceConfig") { putJsonObject("prebuiltVoiceConfig") { put("voiceName", v) } } } } }, v) }
                "openai_tts" -> { val v = voiceOverride?.ifBlank { null } ?: ch.voice.openai; Triple(prov.baseUrl,
                    buildJsonObject { put("model", prov.model ?: "gpt-4o-mini-tts"); put("input", text); put("voice", v); put("speed", p.speed); put("response_format", "mp3"); put("instructions", Emotion.geminiPrefix(cfg, ch, emotion)) }, v) }
                else -> { // edge_tts / kokoro_local: OpenAI-compatible /v1/audio/speech
                    val v = voiceOverride?.ifBlank { null } ?: if (provider == "edge_tts") ch.voice.edge else ch.voice.kokoro
                    Triple(prov.baseUrl, buildJsonObject { put("model", prov.model ?: "tts-1"); put("input", text); put("voice", v); put("speed", p.speed); put("response_format", "mp3") }, v) }
            }

            val t0 = System.currentTimeMillis()
            val resp = runCatching {
                http.newCall(Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }.post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute()
            }.getOrElse { log("$provider error: ${it.message}"); delay(cfg.voiceRoutes.fallbackDelayMs); continue }

            resp.use { r ->
                if (!r.isSuccessful) { log("$provider -> ${r.code}, falling back"); delay(cfg.voiceRoutes.fallbackDelayMs); return@use }
                val bytes = r.body!!.bytes()
                if (provider == "gemini_tts") {
                    val part = json.parseToJsonElement(String(bytes)).jsonObject["candidates"]?.jsonArray?.firstOrNull()?.jsonObject
                        ?.get("content")?.jsonObject?.get("parts")?.jsonArray?.firstOrNull { it.jsonObject.containsKey("inlineData") }?.jsonObject?.get("inlineData")?.jsonObject
                    if (part == null) { log("gemini_tts empty"); return@use }
                    val pcm = Base64.decode(part["data"]!!.jsonPrimitive.content, Base64.DEFAULT)
                    val rate = Regex("rate=(\\d+)").find(part["mimeType"]?.jsonPrimitive?.content ?: "")?.groupValues?.get(1)?.toInt() ?: 24000
                    playPcm(pcm, rate)
                } else {
                    if (bytes.size < 100) { log("$provider empty"); return@use }
                    val f = File.createTempFile("tts", ".mp3", ctx.cacheDir).apply { writeBytes(bytes) }
                    playFile(f)
                }
                val ms = System.currentTimeMillis() - t0
                log("served by $provider voice=$voice emotion=$emotion ${ms}ms")
                return@withContext TtsResult(provider, voice, emotion, text, System.currentTimeMillis() - started, null)
            }
        }
        // Zero keys, no local servers: Android's own TTS so the character still talks.
        log("all providers failed -> android system TTS")
        systemSpeak(ch, text, p)
        TtsResult("android_system", "default", emotion, text, System.currentTimeMillis() - started, null)
    }

    private fun playFile(f: File) { player?.release(); player = MediaPlayer().apply { setDataSource(f.path); prepare(); start() } }

    private fun playPcm(pcm: ByteArray, rate: Int) {
        val track = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(pcm.size).setTransferMode(AudioTrack.MODE_STATIC).build()
        track.write(pcm, 0, pcm.size); track.play()
    }

    private fun systemSpeak(ch: Character, text: String, p: TtsParams) {
        val tts = systemTts ?: TextToSpeech(ctx) { }.also { systemTts = it }
        tts.setSpeechRate(p.speed.toFloat()); tts.setPitch(if (ch.gender == "female") 1.15f else 0.9f)
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nova")
    }

    private fun log(msg: String) { Log.i(TAG, msg); log.addLast(msg); if (log.size > 100) log.removeFirst() }
}
