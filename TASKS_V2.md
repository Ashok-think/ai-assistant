# Jarvish V2 — Real AI Agent Upgrade

Upgrade the **existing** app (do not rebuild). Everything below is **real or explicitly
labelled as a dependency** — no faked success, ever.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[DEP]` needs an external component

---

## HARD TRUTHS (the architecture is built around these)

1. A web page **cannot drive another website** (same-origin policy). The PWA can *open* a URL
   / deep link, read the screen via `getDisplayMedia`, use the clipboard, and analyse uploaded
   images — it **cannot** click inside YouTube or read YouTube's DOM.
2. Real "search → click result → verify" browser control needs a **server-side browser**
   (Playwright/Chromium) running on the PC. `[DEP: Playwright]` — chosen, Apache-2.0.
3. Real on-device Android control (tap/type/read *other* apps) needs a **separate native
   Android app** using AccessibilityService. Cannot be the PWA. `[DEP: native Android app]`.
4. TTS/STT quality is bounded by the configured providers (already handled in V1). The
   ElevenLabs key on file is currently invalid (401) — real voices need a valid key.

We will BUILD the real thing for (2) and SCAFFOLD (3) as a clean module, never fake either.

---

## PHASE A — Agent core (real, no new deps)

- [ ] **A1. Agent Orchestrator** (`src/lib/agent/orchestrator.ts`): OBSERVE→PLAN→ACT→OBSERVE→
      VERIFY→loop with a hard step cap. Wraps the existing `think()` tool loop rather than
      replacing it; adds multi-step planning + verification for action intents.
- [ ] **A2. Tool Registry refactor** (`src/lib/agent/registry.ts`): formalise existing TOOLS
      into name/description/schema/executor/permission/verify. Keep every current tool working.
- [ ] **A3. Verification layer**: after an action, require an observation that proves it
      (tab opened / screen text matches / DOM assertion from Playwright) before saying "done".
      Extend the existing "I couldn't actually do that" honesty guard.
- [ ] **A4. Permission levels** (AUTO / ASK / ALWAYS_CONFIRM) per tool, surfaced to the UI.
- [ ] **A5. Debug panel** (`/api/agent/trace` + UI): intent, plan, model, tool, args, result,
      timing, retries, TTS provider, character state — all from real events.

## PHASE B — Character state machine + activity UI (real, no new deps)

- [ ] **B1. Character state machine** (`src/lib/agent/character-state.ts`): IDLE, LISTENING,
      THINKING, SEARCHING, WORKING, SPEAKING, SUCCESS, ERROR, plus emotion overlay. Driven by
      real orchestrator/voice events, not timers.
- [ ] **B2. Wire states into `CharacterAvatar`** (already has emotion + lip-sync) and Home.
- [ ] **B3. Activity timeline + Task Center** (extend existing `ActionTimeline`): live real
      steps with Cancel/Retry/Details. Each ✓ maps to a verified operation.
- [ ] **B4. Barge-in / interruption**: already stop TTS on speech; make it also cancel an
      in-flight orchestrator run and reset state to LISTENING.

## PHASE C — Real browser control `[DEP: Playwright]`

- [ ] **C1. Playwright browser service** (`src/server/browser/` + a small local daemon or a
      Next route that launches a persistent Chromium context). Tools: `browser_open`,
      `browser_search`, `browser_click`, `browser_type`, `browser_scroll`, `browser_read`,
      `browser_find`, `browser_screenshot`, `browser_back`, `browser_wait`, `browser_verify`.
- [ ] **C2. YouTube workflow** built on C1: open → type query → read results → click best →
      verify title/URL → report. Real, verified.
- [ ] **C3. Domain allowlist + single-tab + popup interception** for safety.
- [ ] **C4. Graceful fallback**: if the Playwright service isn't running, the agent uses the
      existing PWA "open URL in a tab" path and *says so* — never pretends it clicked.

## PHASE D — Native Android control `[DEP: native Android app]`

- [x] **D1. Scaffolded `android-agent/`** (separate from the web build):
      - `AgentAccessibilityService.kt` — reads the UI tree; tap / tapByText / type / scroll /
        swipe / back / home / verify (real gestures + node actions).
      - `BridgeService.kt` — foreground service hosting a loopback HTTP bridge on
        `127.0.0.1:8756`; validates commands against an allowlist; routes to the service or app
        launcher; returns real ok/error. `status` action reports accessibility on/off.
      - Manifest, accessibility config, strings, Gradle files. Play-policy note in README.
- [x] **D2. `AndroidExecutor`** (`src/server/android/executor.ts`) — bridge client, whitelisted
      actions only, never sends credentials, honest failure when unreachable. `androidStatus()`
      probes bridge + accessibility state. `ANDROID_TOOLS` (`android_launch/read/tap_text/tap/
      type/scroll/back/home/verify`) gated behind the `android` skill (opt-in via
      `requiresKey: JARVISH_ANDROID_BRIDGE`). `/api/android/status` + debug-panel line.
- [x] **D3. Connection/permission detection**: status = connected / not connected / skill off /
      accessibility OFF, surfaced in the debug panel and the status API.

**Android build/test status (honest):** the Android SDK, Gradle and adb are NOT installed on
this machine and no device is connected (`ANDROID_HOME` empty, `gradle`/`adb` not found). So the
module cannot be compiled or the on-device YouTube test run here. The code is complete and ready
to open in Android Studio on a real device. The web-side integration (executor, tools, status,
UI) is built and typechecks; every Android tool returns a real "not connected" failure until the
native app is installed — nothing is faked.

## PHASE E — Modularity, vision, research, files, automation

- [x] **E1. Module boundaries** — already separated and confirmed: voice-client, voice-emotion,
      character-state, browser/executor (BrowserExecutor), android/executor (AndroidExecutor),
      router (ModelRouter), intent + tools (ToolRouter), brain (ConversationEngine/Orchestrator),
      vision, files, research. Each is its own module; no monolith.
- [x] **E2. Vision** — shared `src/lib/vision.ts` (`analyzeImage`); `/api/vision/image` +
      `/api/vision/screen`; 📎 image upload in chat. Only runs with a vision-capable key, else
      an honest 503. Image never stored.
- [x] **E3. Web research mode** — `src/lib/research.ts` + `research` tool: real DuckDuckGo +
      Wikipedia source-finding, fetches & extracts page text, returns material WITH source URLs
      for the model to summarize and CITE. Keyless. Verified Wikipedia fetch returns real text.
- [x] **E4. File assistant** — `src/lib/files.ts` (real PDF via pdf-parse v2, DOCX via mammoth,
      TXT/MD/CSV/JSON) + `/api/files` (extract → LLM over the text only). Verified real PDF
      extraction. File never stored; honest error for unsupported/scanned files.
- [x] **E5. Automation/scheduler** — already real: `/api/proactive` fires due reminders,
      mood check-ins, night nudges, upcoming events from memory, stale-todo prompts. Polled by
      the client. No fake automations.
- [x] **E6. Memory manager UI** — already real: `/memory` page + `/api/memories`
      view / add / edit / delete / wipe, plus chat-history browse/delete.

## PHASE F — Verify
- [ ] typecheck / lint / build green after every phase.
- [ ] Run the 20 test commands; each either really executes or honestly states the missing dep.

---

## Open questions for the user (block C/D scope)
1. OK to add a **Playwright backend browser** on the PC for real click/verify? (needed for C)
2. Scaffold the **native Android app** now, or defer and finish PC/web JARVIS first? (D)
3. Background/always-on: "work on my commands in the background, access screen, search" — the
   PWA can run a mic wake-word while the tab is open and read the screen on request; true
   always-on background access to the OS/other apps is the native-Android (D) path.

---

## PHASE F — Live Talking AI Character on the Characters page (done)

- [x] Extracted REAL per-emotion MP3 audio from the 4 emotion videos (ffmpeg) →
      `/public/character/{neutral,happy,angry,calm}.mp3` + `voice-reference.mp3`. Real assets,
      no placeholders. All serve 200.
- [x] `LiveCharacter.tsx` — a "Live AI Character" control center added to the TOP of
      `/characters` (existing Kaito/Yuki/Sora/Ren/Nia/Taro/Mika cards below, unchanged; API
      still returns all 7). Includes: large live preview (video-emotion mode OR true audio
      lip-sync avatar), emotion selector (neutral/happy/excited/sad/angry/shy/sleepy/thinking),
      emotion intensity, speaking speed, render mode, lip-sync ON/OFF, master-voice status chip
      (active / reference ready / preset), Use-as-JARVIS, Preview character voice (plays the
      real extracted mp3 with live lip-sync), Test Voice (master TTS), Test Lip-Sync, Listening/
      Thinking demos, and Interrupt (stops audio+lip-sync → LISTENING).
- [x] `character-assets.ts` extended with `AUDIO` + `audioForEmotion` (real mp3 per emotion).
- [x] Verified: build passes with `/characters` compiled; existing 7 characters intact via
      `/api/characters`; all character mp3/mp4 assets serve 200.

**Honest note on verification:** in this sandbox, fresh shells couldn't reach the dev server's
localhost (network isolation between the managed background process and new exec shells), so I
verified via: (1) the assets serving 200 through the app, (2) the API returning the 7 existing
characters unchanged, (3) a clean production build compiling the `/characters` route with the
new components. The visual browser check (click Test Voice → hear TTS → see mouth move) must be
done by the user in their own browser; the pieces are all real and wired. Audible premium voice
still requires a valid Gemini/ElevenLabs key (the character-voice PREVIEW uses the real extracted
mp3s and works with no key).
