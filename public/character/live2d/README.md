# Live2D character model — drop your rigged anime girl here

This folder is where Jarvish looks for a **real, programmatically-controlled Live2D avatar** of
your character. When a model is present, the Live AI Character on `/characters` renders it live,
lip-syncs it to the actual TTS audio, blinks, moves, breathes and reacts to emotions/states.

Until a model is here, the app honestly shows **"Character rig required"** and uses the
procedural avatar as a labeled fallback. Nothing is faked, and no model file is invented.

## What to place here (exact files)

```
public/character/live2d/
  <name>.model3.json      ← REQUIRED — the model manifest (this is what auto-detection finds)
  <name>.moc3             ← REQUIRED — the rig
  <name>.physics3.json    ← optional — hair/cloth physics
  <name>.cdi3.json        ← optional — parameter display info
  textures/
    texture_00.png        ← REQUIRED — the character artwork atlas(es)
  motions/*.motion3.json  ← optional — idle/gesture motions
  expressions/*.exp3.json ← optional — expression presets
```

You can also nest it in a subfolder (e.g. `public/character/live2d/hikari/hikari.model3.json`);
detection recurses up to 3 levels and picks the first `*.model3.json`.

## Also required: the Live2D Cubism Core (one-time)

Live2D's runtime core is free but proprietary, so it is **not** bundled with this repo.
Download `live2dcubismcore.min.js` from Live2D's official Cubism SDK for Web and place it at:

```
public/live2dcubismcore.min.js
```

If it's missing, the UI says "Model found, but Live2D Cubism Core is missing" and keeps using
the procedural fallback.

## Parameters the renderer drives

The renderer uses the standard Cubism parameter ids. Your rig should expose as many as possible:

| Purpose            | Parameter id        |
|--------------------|---------------------|
| Mouth open (lip-sync) | `ParamMouthOpenY`  |
| Mouth form         | `ParamMouthForm`    |
| Eyes open (blink)  | `ParamEyeLOpen`, `ParamEyeROpen` |
| Eye smile          | `ParamEyeLSmile`    |
| Brows              | `ParamBrowLY`, `ParamBrowRY` |
| Head angle         | `ParamAngleX/Y/Z`   |
| Body angle         | `ParamBodyAngleX`   |
| Breathing          | `ParamBreath`       |

Lip-sync feeds the **live TTS audio amplitude** into `ParamMouthOpenY` with smoothing, so the
mouth tracks the exact words being spoken and stops when speech stops (or on interruption).

## How to create the rig from your art

A flat MP4/PNG cannot be posed in real time — it must be rigged once:

1. Export a clean, front-facing image of the character (e.g. a frame from your MP4).
2. In **Live2D Cubism Editor** (free trial), cut her into layers (hair, face, eyes, pupils,
   brows, mouth shapes, body) and rig the parameters listed above.
3. Export the model (`.model3.json` + `.moc3` + textures) into this folder.
4. Reload `/characters` — Jarvish auto-detects and renders her live.

No rewrite of the character system is needed; only these asset files.
