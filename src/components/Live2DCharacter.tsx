"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import type { MouthFrame } from "@/lib/voice-client";

/**
 * LIVE2D CHARACTER RENDERER
 * -------------------------
 * Renders a real, programmatically-controlled Live2D anime avatar (via PIXI + pixi-live2d-display)
 * and drives its mouth from the ACTUAL TTS audio. This is the real-time avatar the user asked for
 * — not a video, not a static image, not a procedural face.
 *
 * Honest boundaries:
 *  - Needs a real rigged model at public/character/live2d/<name>.model3.json. We never invent one.
 *  - Needs the Live2D Cubism Core script (public/live2dcubismcore.min.js) — free from Live2D but
 *    proprietary, so it isn't bundled. If it's missing we say so and the caller shows the
 *    procedural fallback.
 *
 * Interface (via ref): loadModel, setState, setEmotion, setEmotionIntensity, setLipSync, setMouth,
 * setEyes, setHeadMovement, setVisible, destroy.
 */

export type CharacterRenderState = "idle" | "listening" | "thinking" | "searching" | "working" | "speaking" | "success" | "error";

export type Live2DHandle = {
  loadModel: (url: string) => Promise<void>;
  setState: (s: CharacterRenderState) => void;
  setEmotion: (e: string) => void;
  setEmotionIntensity: (v: number) => void;
  setLipSync: (on: boolean) => void;
  setMouth: (frame: MouthFrame) => void;
  setEyes: (openL: number, openR: number) => void;
  setHeadMovement: (x: number, y: number, z: number) => void;
  setVisible: (v: boolean) => void;
  destroy: () => void;
};

type Status = "init" | "loading" | "ready" | "no-core" | "error";

// Standard Cubism parameter ids (most rigged models use these).
const P = {
  mouthOpen: "ParamMouthOpenY",
  mouthForm: "ParamMouthForm",
  eyeL: "ParamEyeLOpen",
  eyeR: "ParamEyeROpen",
  browL: "ParamBrowLY",
  browR: "ParamBrowRY",
  angleX: "ParamAngleX",
  angleY: "ParamAngleY",
  angleZ: "ParamAngleZ",
  bodyAngleX: "ParamBodyAngleX",
  breath: "ParamBreath",
  eyeSmile: "ParamEyeLSmile",
};

// Emotion → coarse expression targets (form/brow/eye-smile). Same identity, different delivery.
const EMOTION_TARGETS: Record<string, { form: number; brow: number; eyeSmile: number; eyeOpen: number }> = {
  neutral: { form: 0, brow: 0, eyeSmile: 0, eyeOpen: 1 },
  happy: { form: 1, brow: 0.3, eyeSmile: 0.7, eyeOpen: 1 },
  excited: { form: 1, brow: 0.6, eyeSmile: 0.5, eyeOpen: 1.1 },
  laughing: { form: 1, brow: 0.4, eyeSmile: 1, eyeOpen: 0.7 },
  calm: { form: 0.2, brow: 0, eyeSmile: 0.2, eyeOpen: 0.9 },
  sad: { form: -0.7, brow: -0.6, eyeSmile: 0, eyeOpen: 0.7 },
  angry: { form: -0.5, brow: -1, eyeSmile: 0, eyeOpen: 1 },
  surprised: { form: 0.3, brow: 1, eyeSmile: 0, eyeOpen: 1.2 },
  confused: { form: -0.2, brow: 0.5, eyeSmile: 0, eyeOpen: 0.9 },
  shy: { form: 0.4, brow: -0.2, eyeSmile: 0.3, eyeOpen: 0.8 },
  sleepy: { form: 0, brow: -0.3, eyeSmile: 0.1, eyeOpen: 0.4 },
  thinking: { form: -0.1, brow: 0.3, eyeSmile: 0, eyeOpen: 0.9 },
};

const Live2DCharacter = forwardRef<Live2DHandle, { size?: number; onStatus?: (s: Status, detail?: string) => void }>(
  function Live2DCharacter({ size = 300, onStatus }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState<Status>("init");

    // Mutable render state kept in refs so the RAF loop reads live values without re-subscribing.
    const appRef = useRef<unknown>(null);
    const modelRef = useRef<unknown>(null);
    const rafRef = useRef(0);
    const mouthRef = useRef(0); // smoothed mouth open 0..1
    const targetMouthRef = useRef(0);
    const lipSyncRef = useRef(true);
    const emotionRef = useRef<string>("neutral");
    const intensityRef = useRef(1);
    const stateRef = useRef<CharacterRenderState>("idle");
    const headRef = useRef({ x: 0, y: 0, z: 0 });
    const eyesRef = useRef({ l: 1, r: 1 });
    const blinkRef = useRef({ next: 0, closing: 0 });

    const report = (s: Status, detail?: string) => { setStatus(s); onStatus?.(s, detail); };

    useEffect(() => {
      let disposed = false;
      (async () => {
        report("loading");
        // Cubism Core must be present as a global script. It is NOT bundled (proprietary license).
        if (typeof window !== "undefined" && !(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
          // Try to load it from /public if the user placed it there.
          const ok = await loadScript("/live2dcubismcore.min.js").catch(() => false);
          if (!ok || !(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
            if (!disposed) report("no-core", "Live2D Cubism Core script missing (public/live2dcubismcore.min.js).");
            return;
          }
        }
        try {
          const PIXI = await import("pixi.js");
          // pixi-live2d-display needs PIXI on window for its ticker/plugins.
          (window as unknown as { PIXI: unknown }).PIXI = PIXI;
          await import("pixi-live2d-display/cubism4");
          if (disposed || !canvasRef.current) return;
          const app = new PIXI.Application({
            view: canvasRef.current,
            width: size,
            height: size,
            backgroundAlpha: 0,
            antialias: true,
            autoStart: true,
          });
          appRef.current = app;
          report("ready");
          startLoop();
        } catch (e) {
          if (!disposed) report("error", (e as Error).message);
        }
      })();
      return () => {
        disposed = true;
        cancelAnimationFrame(rafRef.current);
        try { (modelRef.current as { destroy?: () => void })?.destroy?.(); } catch { /* noop */ }
        try { (appRef.current as { destroy?: (a: boolean) => void })?.destroy?.(true); } catch { /* noop */ }
        modelRef.current = null;
        appRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size]);

    // The per-frame driver: smooths mouth, applies emotion/blink/breath/head to the model.
    function startLoop() {
      const step = () => {
        const model = modelRef.current as {
          internalModel?: { coreModel?: { setParameterValueById?: (id: string, v: number) => void } };
        } | null;
        const core = model?.internalModel?.coreModel;
        if (core?.setParameterValueById) {
          const set = (id: string, v: number) => core.setParameterValueById!(id, v);
          const now = performance.now();

          // Mouth: exponential smoothing toward the target so it never jitters.
          const target = lipSyncRef.current && stateRef.current === "speaking" ? targetMouthRef.current : 0;
          mouthRef.current += (target - mouthRef.current) * 0.35;
          set(P.mouthOpen, Math.max(0, Math.min(1, mouthRef.current)));

          // Emotion expression (intensity-scaled), identity preserved.
          const t = EMOTION_TARGETS[emotionRef.current] ?? EMOTION_TARGETS.neutral;
          const k = Math.max(0, Math.min(1.5, intensityRef.current));
          set(P.mouthForm, t.form * k);
          set(P.browL, t.brow * k);
          set(P.browR, t.brow * k);
          set(P.eyeSmile, t.eyeSmile * k);

          // Blinking (skip while sleepy/very closed).
          if (now > blinkRef.current.next && blinkRef.current.closing <= 0) blinkRef.current.closing = 1;
          if (blinkRef.current.closing > 0) {
            blinkRef.current.closing -= 0.15;
            if (blinkRef.current.closing <= 0) blinkRef.current.next = now + 2000 + Math.random() * 3000;
          }
          const blink = 1 - Math.max(0, Math.sin(Math.max(0, blinkRef.current.closing) * Math.PI));
          const eyeOpen = t.eyeOpen * blink;
          set(P.eyeL, eyeOpen * eyesRef.current.l);
          set(P.eyeR, eyeOpen * eyesRef.current.r);

          // Head: gentle idle sway + any commanded offset; more animated when speaking/listening.
          const amp = stateRef.current === "speaking" ? 6 : stateRef.current === "listening" ? 4 : 2;
          set(P.angleX, headRef.current.x + Math.sin(now / 1400) * amp);
          set(P.angleY, headRef.current.y + Math.sin(now / 1900) * amp * 0.6);
          set(P.angleZ, headRef.current.z + Math.sin(now / 2300) * amp * 0.4);
          set(P.bodyAngleX, Math.sin(now / 2000) * amp * 0.3);

          // Breathing.
          set(P.breath, (Math.sin(now / 1600) + 1) / 2);
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    }

    useImperativeHandle(ref, (): Live2DHandle => ({
      async loadModel(url: string) {
        const app = appRef.current as { stage: { addChild: (c: unknown) => void }; renderer: { width: number; height: number } } | null;
        if (!app) throw new Error("renderer not ready");
        report("loading");
        try {
          const { Live2DModel } = await import("pixi-live2d-display/cubism4");
          const model = await Live2DModel.from(url, { autoInteract: false });
          // Fit + center.
          const s = (size * 0.9) / Math.max(model.width, model.height);
          model.scale.set(s);
          model.anchor.set(0.5, 0.5);
          model.position.set(size / 2, size / 2);
          app.stage.addChild(model);
          modelRef.current = model;
          report("ready");
        } catch (e) {
          report("error", `Failed to load model: ${(e as Error).message}`);
          throw e;
        }
      },
      setState(sState) { stateRef.current = sState; },
      setEmotion(e) { emotionRef.current = e; },
      setEmotionIntensity(v) { intensityRef.current = v; },
      setLipSync(on) { lipSyncRef.current = on; if (!on) targetMouthRef.current = 0; },
      setMouth(frame) {
        // Map the smoothed audio level to mouth open; viseme nudges mouth form a touch.
        targetMouthRef.current = frame.level;
      },
      setEyes(l, r) { eyesRef.current = { l, r }; },
      setHeadMovement(x, y, z) { headRef.current = { x, y, z }; },
      setVisible(v) { const m = modelRef.current as { visible?: boolean } | null; if (m) m.visible = v; },
      destroy() {
        cancelAnimationFrame(rafRef.current);
        try { (modelRef.current as { destroy?: () => void })?.destroy?.(); } catch { /* noop */ }
        modelRef.current = null;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [size]);

    return (
      <div className="relative" style={{ width: size, height: size }}>
        <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size }} />
        {status !== "ready" && status !== "no-core" && status !== "error" && (
          <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">Preparing renderer…</div>
        )}
      </div>
    );
  },
);

export default Live2DCharacter;

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve(true);
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
