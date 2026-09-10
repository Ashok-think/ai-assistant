package com.nova.companion.tools

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.nova.companion.config.Config
import com.nova.companion.router.ToolCall
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLEncoder
import java.time.Instant

/**
 * Section D — executes tool_calls from the LLM as real Android Intents / local services / HTTP.
 * Risky tools (send_whatsapp, payments, deletes) require [confirm] to return true when agent.confirmRisky is set.
 */
class ToolExecutor(private val ctx: Context, private val cfg: Config, private val confirm: suspend (String) -> Boolean) {

    suspend fun run(call: ToolCall): String {
        val def = cfg.tools.firstOrNull { it.name == call.name } ?: return "unknown tool ${call.name}"
        val args = call.arguments.mapValues { it.value.jsonPrimitive.content }
        if (def.risky && cfg.agent.confirmRisky && !confirm("${call.name} ${args}")) return "cancelled by user"

        return when (call.name) {
            "open_app" -> {
                val pkg = args["package"] ?: return "missing package"
                val launch = ctx.packageManager.getLaunchIntentForPackage(pkg)
                if (launch != null) { ctx.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); "opened $pkg" }
                else { openUrl("https://play.google.com/store/apps/details?id=$pkg"); "app not installed, opened Play Store" }
            }
            "play_youtube" -> { openUrl(fill(def.urlTemplate!!, args)); "searching YouTube for ${args["q"]}" }
            "send_whatsapp" -> { openUrl(fill(def.urlTemplate!!, args)); "WhatsApp opened with message (user must press send)" }
            "web_search", "get_weather" -> HttpTool.get(fill(def.urlTemplate!!, args))
            "set_reminder" -> setReminder(args["text"] ?: "Reminder", args["atIso"] ?: return "missing atIso")
            "read_notifications" -> "requires NotificationListenerService permission (Settings → Notification access)"  // see NotificationReader
            "take_screenshot" -> "handled by AccessibilityExecutorService (Phase 3)"
            else -> "tool ${call.name} not implemented on this platform"
        }
    }

    private fun fill(tpl: String, args: Map<String, String>) = Regex("\\{(\\w+)}").replace(tpl) { URLEncoder.encode(args[it.groupValues[1]] ?: "", "UTF-8") }

    private fun openUrl(url: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    private fun setReminder(text: String, atIso: String): String {
        val at = Instant.parse(atIso).toEpochMilli()
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(ctx, at.toInt(), Intent(ctx, ReminderReceiver::class.java).putExtra("text", text), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        return "reminder set for $atIso: $text"
    }
}

object HttpTool {
    private val http = okhttp3.OkHttpClient()
    fun get(url: String): String = runCatching {
        http.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { it.body?.string()?.take(4000) ?: "" }
    }.getOrElse { "http error: ${it.message}" }
}

/** Posts a notification when the alarm fires. Register in AndroidManifest. */
class ReminderReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val ch = android.app.NotificationChannel("reminders", "Reminders", android.app.NotificationManager.IMPORTANCE_HIGH); nm.createNotificationChannel(ch)
        nm.notify(System.currentTimeMillis().toInt(), android.app.Notification.Builder(context, "reminders")
            .setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle("Nova").setContentText(intent.getStringExtra("text")).build())
    }
}
