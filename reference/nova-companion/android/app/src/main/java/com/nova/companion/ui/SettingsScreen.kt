package com.nova.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.nova.companion.config.*
import com.nova.companion.router.Health
import com.nova.companion.router.LLMRouter
import com.nova.companion.tts.TTSRouter
import kotlinx.coroutines.launch

/**
 * Settings: character picker, voice picker + Test Voice, router profile editor,
 * "Popular Free/Router IDs" table (from assets/config.json), Router Health, Save.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(store: ConfigStore, onSaved: (Config) -> Unit) {
    var cfg by remember { mutableStateOf(store.load()) }
    val scope = rememberCoroutineScope()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var status by remember { mutableStateOf("") }
    var health by remember { mutableStateOf<Map<String, Health>>(emptyMap()) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {

        // ---------- Character picker ----------
        Section("Character") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(cfg.characterEngine.characters) { ch ->
                    val active = ch.id == cfg.characterEngine.activeCharacterId
                    Column(
                        Modifier.width(120.dp).clip(RoundedCornerShape(16.dp))
                            .border(2.dp, if (active) Color(0xFFEC4899) else Color(0xFF334155), RoundedCornerShape(16.dp))
                            .clickable { cfg = cfg.copy(characterEngine = cfg.characterEngine.copy(activeCharacterId = ch.id)) }.padding(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        // Avatars live in assets/avatars/<id>.svg (copied from public/static/avatars). Coil + SVG decoder.
                        AsyncImage(model = "file:///android_asset${ch.avatar}", contentDescription = ch.name, modifier = Modifier.size(84.dp).clip(RoundedCornerShape(12.dp)))
                        Text(ch.name, style = MaterialTheme.typography.titleSmall)
                        Text(ch.inspiredBy, style = MaterialTheme.typography.labelSmall, maxLines = 2)
                    }
                }
            }
            val ch = cfg.activeCharacter()
            Text(ch.personality, style = MaterialTheme.typography.bodySmall)
        }

        // ---------- Voice picker ----------
        Section("Voice") {
            val providers = cfg.voiceRoutes.priority
            var provider by remember { mutableStateOf(providers.first()) }
            var voiceId by remember { mutableStateOf("") }
            val ch = cfg.activeCharacter()
            Dropdown("Provider (priority: ${providers.joinToString(" → ")})", providers, provider) { provider = it; voiceId = "" }
            val list = cfg.voiceRoutes.providers[provider]?.voices ?: emptyList()
            val charDefault = when (provider) { "elevenlabs" -> ch.voice.elevenlabs.name; "gemini_tts" -> ch.voice.gemini; "edge_tts" -> ch.voice.edge; "kokoro_local" -> ch.voice.kokoro; else -> ch.voice.openai }
            Dropdown("Voice (default for ${ch.name}: $charDefault)", list, voiceId.ifBlank { charDefault }) { voiceId = it }
            if (provider == "elevenlabs") OutlinedTextField(voiceId, { voiceId = it }, label = { Text("…or paste any ElevenLabs Voice ID (Voice Library)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = {
                    scope.launch {
                        status = "requesting $provider…"
                        val r = TTSRouter(ctx, cfg, store.env()).speak(ch, ch.samples["good morning"]?.first() ?: "<emo=${ch.defaultEmotion}> Hi, I'm ${ch.name}.", provider, voiceId.ifBlank { null })
                        status = "played via ${r.provider} (${r.voice}) ${r.ms}ms"
                        if (provider == "elevenlabs" && voiceId.isNotBlank() && !list.contains(voiceId)) {
                            val prov = cfg.voiceRoutes.providers.toMutableMap(); prov["elevenlabs"] = prov["elevenlabs"]!!.copy(userPastedId = voiceId)
                            cfg = cfg.copy(voiceRoutes = cfg.voiceRoutes.copy(providers = prov))
                        }
                    }
                }) { Text("Test Voice") }
                Text(status, style = MaterialTheme.typography.labelSmall)
            }
        }

        // ---------- Router profile ----------
        Section("LLM Router") {
            val profiles = cfg.llmRouter.profiles
            var pid by remember { mutableStateOf(cfg.llmRouter.activeProfileId) }
            val p = profiles.first { it.id == pid }
            var base by remember(pid) { mutableStateOf(p.baseUrl) }
            var model by remember(pid) { mutableStateOf(p.modelIds.firstOrNull() ?: "") }
            var paid by remember(pid) { mutableStateOf(p.paidModelId) }
            var key by remember(pid) { mutableStateOf(p.apiKey) }
            var showKey by remember { mutableStateOf(false) }
            var auto by remember { mutableStateOf(cfg.llmRouter.auto) }

            Dropdown("Active profile", profiles.map { it.name }, p.name) { name -> pid = profiles.first { it.name == name }.id }
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(auto, { auto = it }); Text("Auto: ping all, use first 200 < 2 s") }
            OutlinedTextField(base, { base = it }, label = { Text("Base URL") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(model, { model = it }, label = { Text("Model ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(paid, { paid = it }, label = { Text("Paid fallback model") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(key, { key = it }, label = { Text(if (p.apiKeyEnv.isBlank()) "API key (not needed)" else "API key → ${p.apiKeyEnv}") },
                visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(autoCorrect = false), singleLine = true, modifier = Modifier.fillMaxWidth(),
                trailingIcon = { IconButton({ showKey = !showKey }) { Icon(if (showKey) Icons.Default.VisibilityOff else Icons.Default.Visibility, "toggle") } })

            fun apply(): Config = cfg.copy(llmRouter = cfg.llmRouter.copy(activeProfileId = pid, auto = auto,
                profiles = profiles.map { if (it.id != pid) it else it.copy(baseUrl = base.trim(), modelIds = listOf(model.trim()) + it.modelIds.drop(1), paidModelId = paid.trim(), apiKey = key.trim()) }))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { cfg = apply(); store.save(cfg); onSaved(cfg); status = "saved" }) { Text("Save") }
                OutlinedButton(onClick = { scope.launch { val c = apply(); health = health + (pid to LLMRouter(c, store.env()).ping(c.llmRouter.profiles.first { it.id == pid }, model)) } }) { Text("Ping Router") }
                OutlinedButton(onClick = { scope.launch { health = LLMRouter(apply(), store.env()).pingAll().toMap() } }) { Text("Router Health") }
            }
            profiles.forEach { pr ->
                val h = health[pr.id]
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(when { h == null -> Color.Gray; h.ok -> Color(0xFF22C55E); else -> Color(0xFFEF4444) }))
                    Spacer(Modifier.width(8.dp)); Text(pr.name, Modifier.weight(1f))
                    Text(h?.let { if (it.ok) "${it.ms} ms" else it.error ?: "down" } ?: "—", style = MaterialTheme.typography.labelSmall)
                }
            }
        }

        // ---------- Popular IDs table (static, from assets/config.json) ----------
        Section("Popular Free / Router IDs") {
            Text("Copy any ID into the Model ID field. The app does not validate IDs — the router does.", style = MaterialTheme.typography.labelSmall)
            cfg.modelIdTable.forEach { row ->
                Text(row.router, style = MaterialTheme.typography.titleSmall)
                Text("Free: " + row.free.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = Color(0xFFF9A8D4))
                Text("Paid: " + row.paid.joinToString(", "), style = MaterialTheme.typography.bodySmall)
                Divider()
            }
        }

        OutlinedButton(onClick = { store.reset(); cfg = store.load(); status = "reset to defaults" }) { Text("Reset to defaults") }
    }
}

@Composable private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text(title, style = MaterialTheme.typography.titleMedium); content() } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun Dropdown(label: String, options: List<String>, value: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { open = it }) {
        OutlinedTextField(value, {}, readOnly = true, label = { Text(label) }, modifier = Modifier.fillMaxWidth().menuAnchor(), trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) })
        ExposedDropdownMenu(open, { open = false }) { options.forEach { o -> DropdownMenuItem(text = { Text(o) }, onClick = { onPick(o); open = false }) } }
    }
}

private fun Modifier.clip(shape: androidx.compose.ui.graphics.Shape) = androidx.compose.ui.draw.clip(this, shape)
