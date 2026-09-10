package com.nova.companion.config

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Mirrors public/static/config.json (same schema as the web app).
// Load order: assets/config.json (defaults) -> EncryptedSharedPreferences "user_config" (overrides).

@Serializable data class TtsParams(val stability: Double, val style: Double, val speed: Double)
@Serializable data class TtsBias(val stability: Double = 0.0, val style: Double = 0.0, val speed: Double = 0.0)

@Serializable data class ElevenVoice(val name: String, val id: String, val stability: Double, val style: Double)
@Serializable data class CharacterVoice(
    val elevenlabs: ElevenVoice, val gemini: String, val edge: String, val kokoro: String, val openai: String = "alloy",
)

@Serializable data class Character(
    val id: String, val name: String, val avatar: String, val inspiredBy: String, val gender: String,
    val personality: String, val style: String, val catchphrases: List<String>,
    val defaultEmotion: String, val bias: TtsBias = TtsBias(), val voice: CharacterVoice,
    val samples: Map<String, List<String>> = emptyMap(),
)

@Serializable data class CharacterEngine(
    val activeCharacterId: String, val emotions: List<String>,
    val emotionToTts: Map<String, TtsParams>, val geminiStyleByEmotion: Map<String, String>,
    val characters: List<Character>,
)

@Serializable data class VoiceProvider(
    val baseUrl: String, val voicesUrl: String? = null, val headers: Map<String, String> = emptyMap(),
    val model: String? = null, val voices: List<String> = emptyList(), val userPastedId: String = "",
)
@Serializable data class VoiceRoutes(val priority: List<String>, val fallbackDelayMs: Long = 500, val providers: Map<String, VoiceProvider>)

@Serializable data class RouterProfile(
    val id: String, val name: String, val provider: String,   // openrouter | openai_compat | gemini
    val baseUrl: String, val apiKeyEnv: String = "", val apiKey: String = "",
    val headers: Map<String, String> = emptyMap(), val modelIds: List<String>, val paidModelId: String = "",
    val maxTokens: Int = 400, val temperature: Double = 0.9,
)
@Serializable data class FallbackModel(val profileId: String, val modelId: String)
@Serializable data class Price(@SerialName("in") val input: Double, val out: Double)
@Serializable data class LlmRouterConfig(
    val activeProfileId: String, val auto: Boolean = true, val pingTimeoutMs: Long = 2000,
    val fallbackModel: FallbackModel, val profiles: List<RouterProfile>,
    val pricingPer1MTokens: Map<String, Price> = emptyMap(),
)

@Serializable data class ToolDef(
    val name: String, val description: String, val kind: String, // android_intent | url | http | android_local
    val risky: Boolean = false, val urlTemplate: String? = null, val androidAction: String? = null,
    val androidService: String? = null, val parameters: kotlinx.serialization.json.JsonObject,
)

@Serializable data class ScreenVerifier(val mode: String, val useLlmProfile: String)
@Serializable data class AgentConfig(
    val accessibilityExecutor: String, val screenVerifier: ScreenVerifier,
    val retryLimit: Int = 3, val confirmRisky: Boolean = true, val riskyCategories: List<String>,
)
@Serializable data class ModelIdRow(val router: String, val free: List<String>, val paid: List<String>)

@Serializable data class Config(
    val version: Int = 1,
    val characterEngine: CharacterEngine,
    val voiceRoutes: VoiceRoutes,
    val llmRouter: LlmRouterConfig,
    val tools: List<ToolDef>,
    val agent: AgentConfig,
    val modelIdTable: List<ModelIdRow>,
) {
    fun activeCharacter() = characterEngine.characters.firstOrNull { it.id == characterEngine.activeCharacterId } ?: characterEngine.characters.first()
    fun activeProfile() = llmRouter.profiles.firstOrNull { it.id == llmRouter.activeProfileId } ?: llmRouter.profiles.first()
}

/** Loads defaults from assets, applies user overrides, and stores API keys in EncryptedSharedPreferences. */
class ConfigStore(private val ctx: Context) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true; encodeDefaults = true }
    private val prefs by lazy {
        EncryptedSharedPreferences.create(
            ctx, "nova_secure",
            MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun defaults(): Config = json.decodeFromString(ctx.assets.open("config.json").bufferedReader().readText())

    fun load(): Config {
        val user = prefs.getString(KEY_CONFIG, null) ?: return defaults().withKeys()
        return runCatching { json.decodeFromString<Config>(user) }.getOrElse { defaults() }.withKeys()
    }

    fun save(cfg: Config) {
        // Strip keys out of the JSON blob; they live under their own encrypted entries.
        val stripped = cfg.copy(llmRouter = cfg.llmRouter.copy(profiles = cfg.llmRouter.profiles.map { p ->
            if (p.apiKey.isNotBlank()) setKey(p.apiKeyEnv.ifBlank { "PROFILE_${p.id}" }, p.apiKey); p.copy(apiKey = "")
        }))
        prefs.edit().putString(KEY_CONFIG, json.encodeToString(Config.serializer(), stripped)).apply()
    }

    fun reset() = prefs.edit().remove(KEY_CONFIG).apply()

    // ---- API keys: linked to profile via apiKeyEnv (e.g. OPENROUTER_API_KEY) ----
    fun setKey(envName: String, value: String) = prefs.edit().putString("key:$envName", value).apply()
    fun getKey(envName: String): String = if (envName.isBlank()) "" else prefs.getString("key:$envName", "") ?: ""
    fun env(): Map<String, String> = prefs.all.filterKeys { it.startsWith("key:") }.map { it.key.removePrefix("key:") to (it.value as String) }.toMap()

    private fun Config.withKeys() = copy(llmRouter = llmRouter.copy(profiles = llmRouter.profiles.map { it.copy(apiKey = getKey(it.apiKeyEnv.ifBlank { "PROFILE_${it.id}" })) }))

    companion object { private const val KEY_CONFIG = "user_config" }
}

/** ${VAR} substitution using the encrypted key store. */
fun String.substituteEnv(env: Map<String, String>) = Regex("\\$\\{([A-Z0-9_]+)}").replace(this) { env[it.groupValues[1]] ?: "" }
