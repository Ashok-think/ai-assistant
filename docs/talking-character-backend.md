# Talking Character — Remote GPU Lip-Sync Backend Contract

Jarvish generates a NEW talking video of your anime character by sending the source clip + the
real TTS audio to a **remote GPU backend** (this PC has no NVIDIA GPU, so local rendering is
intentionally disabled and reports "unavailable"). The backend is **vendor-neutral** — point
Jarvish at any server that implements the endpoints below. No RunPod/Replicate/Colab is hard-coded.

## Environment variables (server-side only)

```
TALKING_CHARACTER_PROVIDER = local | remote      # default: remote if URL set, else local
REMOTE_LIPSYNC_URL         = https://your-gpu-backend.example.com   # base URL, no trailing slash
REMOTE_LIPSYNC_API_KEY     = <secret>            # sent as: Authorization: Bearer <key>
NEXT_PUBLIC_BASE_URL       = http://localhost:3000  # so the backend can be handed absolute source URLs
```

`REMOTE_LIPSYNC_API_KEY` is read only on the server and sent as a Bearer header. It is **never**
exposed to the browser.

## Endpoints the backend must implement

All requests include `Authorization: Bearer <REMOTE_LIPSYNC_API_KEY>` when a key is set.

### `POST /create` — start a job
`multipart/form-data`:

| field          | type   | notes                                             |
|----------------|--------|---------------------------------------------------|
| `source_video` | file   | the source character clip (mp4)                   |
| `audio`        | file   | the EXACT TTS speech to lip-sync (mp3/wav)        |
| `emotion`      | string | e.g. `happy`, `neutral`, `angry`                  |
| `intensity`    | string | number 0..1.5                                     |

Response (any of these key spellings accepted): 
```json
{ "jobId": "abc123", "status": "queued" }
```

### `GET /status/:jobId`
```json
{ "status": "queued|processing|succeeded|failed|canceled", "progress": 0.42 }
```

### `GET /result/:jobId`
```json
{ "videoUrl": "https://.../abc123.mp4", "status": "succeeded" }
```
(`video_url` / `url` also accepted.) The URL must be fetchable by the browser.

### `POST /cancel/:jobId`  (optional)
```json
{ "ok": true }
```

### `GET /health`  (optional)
`200 OK` marks the backend "available"; absence just means "ready, unverified".

## Suitable engines to run on the backend

Run whichever real audio-driven lip-sync model you prefer on the GPU box, e.g. **MuseTalk**,
**SadTalker**, or **Wav2Lip** — wrap it behind the endpoints above. The engine choice is entirely
on the backend; Jarvish stays engine-agnostic through `TalkingCharacterProvider`.

## What Jarvish does NOT do

- It never runs slow CPU lip-sync inside the app.
- It never plays the original MP4 as a substitute for a generated talking video.
- It never reports "available" unless a backend is actually configured/reachable.
- CSS/timer mouth animation is not used as a stand-in for real AI video.

The procedural avatar remains an explicitly-labeled fallback for the live view, and the Live2D
renderer remains available for a future rigged model — both independent of this backend.
