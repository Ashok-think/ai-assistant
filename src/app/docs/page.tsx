import { DEFAULT_CHARACTERS, buildSystemPrompt } from "@/lib/characters";

export const dynamic = "force-dynamic";

const ARCH = `
┌──────────────────────────────  CLIENTS  ──────────────────────────────┐
│  Flutter app (Android/iOS)        Web companion (this Next.js app)     │
│  • wake word (Porcupine)          • Web Speech API STT + wake word     │
│  • Whisper STT (on-device/API)    • ElevenLabs → browser TTS fallback  │
│  • ElevenLabs streaming TTS       • Animated SVG character + HUD       │
│  • Rive/Lottie avatar, lip-sync   • Proactive toasts (polling)         │
│  • Background service, widget     • Agent live-progress view           │
└──────────────┬──────────────────────────────────┬─────────────────────┘
               │  HTTPS / SSE                     │
┌──────────────▼──────────────────────────────────▼─────────────────────┐
│                     API LAYER  (Next.js Route Handlers)                │
│  /api/chat (SSE)  /api/agent (SSE)  /api/tts  /api/proactive  /api/*   │
└──────────────┬────────────────────────────────────────────────────────┘
               │
┌──────────────▼────────────────────  BRAIN  ────────────────────────────┐
│  Character Engine ─► System prompt (persona + memory + tools + lang)   │
│  TOKEN ROUTER ─► complexity score → fast | smart | local | offline     │
│      • budget + free-only + low-power guards • cost/latency logging    │
│  LLM client (OpenAI-compatible: OpenAI / Groq / OpenRouter / Ollama)   │
│  Tool loop (function calling, ≤6 hops) ─► Skill registry              │
│  Offline Persona Engine (rule-based intents, zero-key fallback)        │
└───────┬───────────────────────────┬───────────────────────────┬────────┘
        │                           │                           │
┌───────▼────────┐        ┌─────────▼─────────┐       ┌─────────▼────────┐
│  PostgreSQL    │        │  External APIs     │       │  Device bridge   │
│  settings      │        │  Open-Meteo        │       │  (Flutter side)  │
│  characters    │        │  DuckDuckGo/Wiki   │       │  apps, calls,    │
│  messages      │        │  MyMemory translate│       │  SMS, alarms,    │
│  memories      │        │  JokeAPI, Dict     │       │  volume, torch,  │
│  reminders…    │        │  ElevenLabs        │       │  notifications   │
│  usage_logs    │        │  LLM providers     │       │  Home Assistant  │
└────────────────┘        └───────────────────┘       └──────────────────┘
`;

const FOLDERS = `
web/ (this repo)
├─ src/app/
│  ├─ page.tsx                 Home HUD (avatar, voice, chat, router HUD)
│  ├─ agent/  characters/  memory/  skills/  settings/  docs/
│  └─ api/
│     ├─ chat/route.ts         SSE: route → tools → final (in character)
│     ├─ agent/route.ts        plan → execute → synthesize (live progress)
│     ├─ tts/route.ts          ElevenLabs proxy (204 → browser fallback)
│     ├─ proactive/route.ts    due reminders + nudges
│     ├─ characters/ memories/ conversations/ settings/ skills/ routines/ usage/ state/
├─ src/lib/
│  ├─ characters.ts            Character seeds + SYSTEM PROMPT TEMPLATE + greetings
│  ├─ router.ts                TOKEN ROUTER (classify, budget, provider pick, logging)
│  ├─ llm.ts                   OpenAI-compatible chat client w/ tool calling
│  ├─ tools.ts                 Skill registry (weather, search, reminders, todos…)
│  ├─ offline.ts               Offline persona engine (works with no API key)
│  ├─ brain.ts                 Orchestrator: memory → route → loop → persist
│  ├─ bootstrap.ts             Seeding + settings helpers
│  └─ voice-client.ts          STT, wake word, TTS w/ interrupt, tone analyzer
├─ src/components/             CharacterAvatar, Waveform, Home, Nav
└─ src/db/schema.ts            Drizzle schema (13 tables)

mobile/ (Flutter — skeleton below)
├─ lib/main.dart
├─ lib/core/{voice_pipeline.dart, wake_word.dart, tts.dart, stt.dart}
├─ lib/features/{home, chat, characters, agent, settings}/
├─ lib/services/{api_client.dart, device_tools.dart, memory_sync.dart}
└─ android/ ios/ (permissions, background service, widgets)
`;

const STACK = `
LAYER            PRIMARY (best quality)                 FREE / OFFLINE ALTERNATIVE
LLM smart        GPT-4o / Claude 3.5 (via OpenRouter)   Groq llama-3.3-70b (free tier)
LLM fast         GPT-4o-mini                            Groq llama-3.1-8b-instant (free)
LLM local        —                                      Ollama (llama3.2 / gemma / phi) · MLC/llama.cpp on device
TTS              ElevenLabs multilingual v2 (+cloning)  Browser speechSynthesis · Edge-TTS · Piper (offline)
STT              OpenAI Whisper API (streaming)         Web Speech API · whisper.cpp / faster-whisper on device
Wake word        Picovoice Porcupine ("Hey <name>")     openWakeWord · in-app keyword match (this web app)
Vector memory    pgvector (Postgres)                    Keyword recall (implemented) · Chroma · SQLite-vss
Weather          Open-Meteo (free, no key)              —
Search           Tavily / Brave Search API              DuckDuckGo Instant Answers + Wikipedia (implemented)
Translate        DeepL / LLM                            MyMemory (implemented)
Smart home       Home Assistant REST                    —
Mobile           Flutter 3.x (Riverpod, dio, rive, flutter_tts, speech_to_text,
                 porcupine_flutter, flutter_background_service, home_widget)
Web              Next.js 16 · Tailwind 4 · Drizzle · PostgreSQL
`;

const PLAN = `
WEEK 1 — MVP (this repo ✅)
  D1  Schema, settings, character seeds, bootstrap
  D2  Token router + LLM client + offline engine
  D3  Tool registry (weather, reminders, todos, notes, memory, search, translate, mood, math, jokes)
  D4  Home HUD: avatar, emotions, lip-sync, waveform, chat SSE
  D5  Voice: STT, wake word, TTS with interrupt, tone analyzer
  D6  Characters page + Custom Character Creator, Memory page
  D7  Agent mode, Skills store, Routines, Settings + usage dashboard

WEEK 2 — Flutter app
  • Port API client, HUD, chat, character picker
  • Porcupine wake word + background service + foreground notification
  • Whisper STT (on-device via whisper.cpp FFI or API), ElevenLabs streaming
  • Native device tools via platform channels (apps, calls, SMS, alarms, torch, volume)

WEEK 3 — Intelligence
  • pgvector embeddings for memory, auto memory extraction after each chat
  • Realtime voice-to-voice (OpenAI Realtime / Gemini Live) < 1s
  • Vision mode (camera frames → multimodal model), OCR (ML Kit)
  • Emotion from voice (openSMILE / on-device classifier)

WEEK 4 — Polish & 2026 features
  • Rive avatars with visemes, AR mode (ARCore/ARKit)
  • Live translation conversation mode
  • Plugin store manifests (JSON) + sandboxed JS skills
  • Lock-screen widget, floating bubble, low-battery scheduler
  • Encryption at rest (SQLCipher on device), export/import memory
`;

const FLUTTER = `// mobile/lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'features/home/home_screen.dart';

void main() => runApp(const ProviderScope(child: CompanionApp()));

class CompanionApp extends StatelessWidget {
  const CompanionApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Companion',
        theme: ThemeData.dark(useMaterial3: true).copyWith(
          scaffoldBackgroundColor: const Color(0xFF05060F),
          colorScheme: const ColorScheme.dark(primary: Color(0xFF7C3AED), secondary: Color(0xFF22D3EE)),
        ),
        home: const HomeScreen(),
      );
}

// mobile/lib/core/voice_pipeline.dart
// wake word → STT → /api/chat (SSE) → TTS   (with barge-in interrupt)
import 'dart:async';
import 'package:porcupine_flutter/porcupine_manager.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:just_audio/just_audio.dart';
import '../services/api_client.dart';

class VoicePipeline {
  final ApiClient api;
  final SpeechToText stt = SpeechToText();
  final FlutterTts localTts = FlutterTts();
  final AudioPlayer player = AudioPlayer();
  PorcupineManager? _wake;
  final _events = StreamController<VoiceEvent>.broadcast();
  Stream<VoiceEvent> get events => _events.stream;

  VoicePipeline(this.api);

  Future<void> startWakeWord(String accessKey, String keywordPath) async {
    _wake = await PorcupineManager.fromKeywordPaths(accessKey, [keywordPath], (_) => listenOnce());
    await _wake!.start();
  }

  Future<void> listenOnce({String locale = 'en_US'}) async {
    await interrupt(); // barge-in: stop any speech
    _events.add(VoiceEvent.listening);
    if (!await stt.initialize()) return;
    final done = Completer<String>();
    stt.listen(
      localeId: locale,
      listenOptions: SpeechListenOptions(partialResults: true),
      pauseFor: const Duration(milliseconds: 1400),
      onResult: (r) {
        _events.add(VoiceEvent.partial(r.recognizedWords));
        if (r.finalResult && !done.isCompleted) done.complete(r.recognizedWords);
      },
    );
    final text = await done.future;
    await stt.stop();
    if (text.trim().isEmpty) return;
    await respond(text);
  }

  Future<void> respond(String text) async {
    _events.add(VoiceEvent.thinking);
    await for (final ev in api.chatStream(text)) {
      if (ev.type == 'tool') _events.add(VoiceEvent.tool(ev.name));
      if (ev.type == 'final') {
        _events.add(VoiceEvent.reply(ev.content, ev.emotion));
        await speak(ev.content, ev.emotion);
      }
    }
  }

  Future<void> speak(String text, String emotion) async {
    _events.add(VoiceEvent.speaking);
    final url = await api.ttsUrl(text, emotion); // ElevenLabs via server, null if unavailable
    if (url != null) {
      await player.setUrl(url);
      await player.play();
    } else {
      await localTts.setPitch(emotion == 'excited' ? 1.2 : 1.0);
      await localTts.speak(text);
    }
    _events.add(VoiceEvent.idle);
  }

  Future<void> interrupt() async {
    await player.stop();
    await localTts.stop();
  }
}

class VoiceEvent {
  final String type; final String? text; final String? emotion;
  const VoiceEvent._(this.type, [this.text, this.emotion]);
  static const listening = VoiceEvent._('listening');
  static const thinking = VoiceEvent._('thinking');
  static const speaking = VoiceEvent._('speaking');
  static const idle = VoiceEvent._('idle');
  factory VoiceEvent.partial(String t) => VoiceEvent._('partial', t);
  factory VoiceEvent.tool(String n) => VoiceEvent._('tool', n);
  factory VoiceEvent.reply(String t, String e) => VoiceEvent._('reply', t, e);
}

// mobile/lib/services/api_client.dart  (talks to this Next.js backend)
import 'dart:convert';
import 'package:dio/dio.dart';

class ChatEvent { final String type; final String name; final String content; final String emotion;
  ChatEvent(this.type, {this.name = '', this.content = '', this.emotion = 'neutral'}); }

class ApiClient {
  final Dio _dio;
  ApiClient(String baseUrl) : _dio = Dio(BaseOptions(baseUrl: baseUrl));

  Stream<ChatEvent> chatStream(String message, {int? conversationId}) async* {
    final res = await _dio.post('/api/chat',
        data: {'message': message, 'conversationId': conversationId},
        options: Options(responseType: ResponseType.stream));
    await for (final chunk in (res.data.stream as Stream<List<int>>).transform(utf8.decoder).transform(const LineSplitter())) {
      if (!chunk.startsWith('data: ')) continue;
      final j = jsonDecode(chunk.substring(6));
      yield ChatEvent(j['type'], name: j['name'] ?? '', content: j['message']?['content'] ?? '', emotion: j['message']?['emotion'] ?? 'neutral');
    }
  }

  Future<String?> ttsUrl(String text, String emotion) async {
    final r = await _dio.post('/api/tts', data: {'text': text, 'emotion': emotion}, options: Options(responseType: ResponseType.bytes));
    if (r.statusCode != 200) return null;
    // write bytes to temp file and return file:// path
    return null; // TODO: save r.data to cache dir
  }
}

// mobile/lib/services/device_tools.dart — native tools executed on phone
// (called when the backend returns device_action tool results)
import 'package:url_launcher/url_launcher.dart';
import 'package:torch_light/torch_light.dart';
import 'package:flutter_volume_controller/flutter_volume_controller.dart';
import 'package:android_intent_plus/android_intent.dart';

class DeviceTools {
  static Future<String> run(String action, String? target) async {
    switch (action) {
      case 'open':       await AndroidIntent(action: 'android.intent.action.MAIN', package: target).launch(); return 'Opened \$target';
      case 'call':       await launchUrl(Uri.parse('tel:\$target')); return 'Calling \$target';
      case 'sms':        await launchUrl(Uri.parse('sms:\$target')); return 'SMS to \$target';
      case 'whatsapp':   await launchUrl(Uri.parse('https://wa.me/\$target')); return 'WhatsApp \$target';
      case 'flashlight': await TorchLight.enableTorch(); return 'Flashlight on';
      case 'volume':     await FlutterVolumeController.setVolume(double.parse(target ?? '0.5')); return 'Volume set';
      case 'alarm':      await AndroidIntent(action: 'android.intent.action.SET_ALARM', arguments: {'android.intent.extra.alarm.HOUR': 7}).launch(); return 'Alarm set';
      default:           return 'Unknown action';
    }
  }
}

// pubspec.yaml (key deps)
// flutter_riverpod, dio, speech_to_text, flutter_tts, just_audio, porcupine_flutter,
// rive, flutter_background_service, home_widget, url_launcher, torch_light,
// flutter_volume_controller, android_intent_plus, permission_handler, sqflite_sqlcipher, camera, google_mlkit_text_recognition
`;

const SETUP = `
1) Run the web companion
   • npm install && npx drizzle-kit push && npm run dev  → http://localhost:3000
   • It works instantly with ZERO keys (offline persona engine + free tools).

2) Get a FREE brain (recommended first step)
   • Go to console.groq.com → API Keys → Create → copy "gsk_…"
   • Paste into Settings → API keys → Groq. Done. Fast + smart Llama models, free tier.

3) Premium options
   • OpenAI: platform.openai.com → API keys (GPT-4o-mini fast / GPT-4o smart)
   • OpenRouter: openrouter.ai → Keys (access Claude/Gemini + ":free" models)
   • ElevenLabs: elevenlabs.io → Profile → API key. Paste in Settings. Optional per-character voice ID
     (Characters → Edit → ElevenLabs voice ID). Voice cloning: ElevenLabs → Voices → Add → Instant clone.

4) Offline / on-device
   • Install Ollama (ollama.com), run: ollama pull llama3.2 && ollama serve
   • Settings → Ollama URL = http://localhost:11434 → Routing mode "Local".

5) Environment variables (production) — .env
   OPENAI_API_KEY=  GROQ_API_KEY=  OPENROUTER_API_KEY=  ELEVENLABS_API_KEY=  ELEVENLABS_VOICE_ID=
   OLLAMA_BASE_URL=  FAST_MODEL=gpt-4o-mini  SMART_MODEL=gpt-4o  DATABASE_URL=postgres://…

6) Voice in the browser
   • Use Chrome/Edge. Click "Talk" once to grant mic. "Wake word" button arms always-on listening.
   • Change the name in Settings → wake word auto-updates to "hey <name>".

7) Run the Flutter app on your phone
   • flutter create mobile && copy the skeleton files from Docs into lib/
   • flutter pub add flutter_riverpod dio speech_to_text flutter_tts just_audio porcupine_flutter …
   • Set ApiClient('https://<your-web-url>') → flutter run (USB debugging on Android)
   • Porcupine: get a free AccessKey at console.picovoice.ai and train "Hey <Name>" keyword (.ppn).
`;

const IDEAS = `
• Realtime duplex voice (OpenAI Realtime / Gemini Live) with server-side VAD & barge-in
• pgvector semantic memory + nightly "dream" consolidation (summarize the day into memories)
• Character "relationship level" that unlocks new catchphrases & outfits
• Multi-character group chat (Kaito & Ren argue about your study plan)
• Live translation conversation mode with two-speaker diarization
• Screen awareness on Android (AccessibilityService) → "what's this error?"
• Camera vision: "what's this?" / calorie estimate / read this sign / solve this problem
• AR mode: character stands on your desk (ARCore/ARKit + Rive)
• Habit tracker & streaks announced in character voice
• Spotify / YouTube Music DJ mode with mood-based playlists
• Home Assistant scenes: "movie night" dims lights + speaks in Mika's voice
• Voice-cloned family voices for reminders (with consent)
• Study mode: spaced-repetition flashcards, quiz me, Pomodoro with hype breaks
• Dream journal, gratitude journal, mood analytics dashboard
• Shared companion: sync memory across devices with end-to-end encryption
• Plugin marketplace with signed JSON manifests and WASM/JS sandboxed skills
• Wearables: watch complication + quick voice replies
• Emotion-aware model routing: when user is sad → prefer the empathetic smart model
`;

export default function DocsPage() {
  const sampleChar = DEFAULT_CHARACTERS[0];
  const template = buildSystemPrompt({
    character: sampleChar,
    assistantName: "[NAME]",
    userName: "[USER]",
    language: "auto",
    memories: ["[memory 1 — e.g. User's exam is on 12 March]", "[memory 2 — e.g. Loves lo-fi and ramen]"],
    safeMode: false,
    toolNames: ["get_weather", "web_search", "set_reminder", "add_todo", "save_note", "remember_fact", "log_mood", "…"],
    recentMood: "[last mood]",
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">📚 Blueprint & Docs</h1>
        <p className="text-sm text-slate-400">Everything requested in the deliverables: architecture, stack, character prompt template, build plan, Flutter skeleton, setup guide, and future ideas.</p>
      </header>

      <Section title="1 · System architecture" body={ARCH} />
      <Section title="1b · Folder structure" body={FOLDERS} />
      <Section title="2 · Tech stack (with free alternatives)" body={STACK} />

      <div className="panel p-5">
        <h2 className="text-lg font-semibold text-cyan-200">3 · Character system prompt template</h2>
        <p className="mt-1 text-xs text-slate-400">Generated live by <code>buildSystemPrompt()</code> in <code>src/lib/characters.ts</code>. Below is the template filled with the Kaito (Naruto-inspired) persona. Every character uses the same skeleton with its own persona block.</p>
        <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-4 text-xs text-slate-200">{template}</pre>
        <h3 className="mt-4 text-sm font-semibold text-slate-200">Persona blocks for all defaults</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {DEFAULT_CHARACTERS.map((c) => (
            <div key={c.slug} className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
              <div className="font-semibold" style={{ color: c.accent }}>{c.emoji} {c.name} — {c.tagline}</div>
              <p className="mt-1 text-slate-300">{c.personalityPrompt}</p>
              <p className="mt-1 text-slate-400">Style: {c.speakingStyle}</p>
              <p className="mt-1 text-slate-400">Calls you: “{c.nickname}” · Catchphrases: {c.catchphrases.join(" / ")}</p>
              <p className="mt-1 text-slate-500">Voice: pitch {c.voice.pitch}, rate {c.voice.rate}, warmth {c.voice.warmth} · dials funny {c.sliders.funny} / soft {c.sliders.soft} / calm {c.sliders.calm}</p>
            </div>
          ))}
        </div>
      </div>

      <Section title="4 · Step-by-step build plan (MVP week 1 → full)" body={PLAN} />

      <div className="panel p-5">
        <h2 className="text-lg font-semibold text-cyan-200">5 · Code delivered</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li><b>Voice pipeline</b> (web): <code>src/lib/voice-client.ts</code> — wake word → STT → LLM → TTS with interrupt & tone analysis.</li>
          <li><b>Character engine</b>: <code>src/lib/characters.ts</code> + Characters page (custom creator with sliders, voice, catchphrases, emotion faces, lip-sync).</li>
          <li><b>Token router</b>: <code>src/lib/router.ts</code> — complexity classifier, budget & free-only guards, provider selection, cost/latency logging (dashboard in Settings).</li>
          <li><b>Tools</b> (16 working): weather, web search, reminders (set/list), todos (add/list/complete), notes, memory (remember/recall), mood, time, calculator, translate, joke, dictionary, device actions.</li>
          <li><b>Agent mode</b>: <code>src/app/api/agent/route.ts</code> — plan → execute tools → synthesize with live progress.</li>
          <li><b>Flutter skeleton</b> below (main, voice pipeline, API client, native device tools).</li>
        </ul>
        <pre className="mt-3 max-h-[36rem] overflow-auto rounded-xl bg-black/40 p-4 text-xs text-slate-200">{FLUTTER}</pre>
      </div>

      <Section title="6 · Beginner setup guide" body={SETUP} />
      <Section title="7 · Future feature ideas" body={IDEAS} />
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-5">
      <h2 className="text-lg font-semibold text-cyan-200">{title}</h2>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-4 text-xs leading-relaxed text-slate-200">{body.trim()}</pre>
    </div>
  );
}
