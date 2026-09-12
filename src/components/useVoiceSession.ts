"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createToneAnalyzer, getRecognizerCtor, langToBcp47 } from "@/lib/voice-client";
import { INITIAL_VOICE, VoiceSession, type VoiceMode } from "@/lib/voice-session";

type Options = { phrase: string; language: string; onCommand: (command: string) => void; onInterrupt: () => void; isOccupied: () => boolean };

export function useVoiceSession(options: Options) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; }, [options]);
  const session = useRef<VoiceSession | null>(null);
  const [voice, setVoice] = useState(INITIAL_VOICE);
  const [micLevel, setMicLevel] = useState(0);
  const [tone, setTone] = useState("");

  useEffect(() => {
    let disposed = false;
    let analyzerGeneration = 0;
    let analyzerRequested = false;
    let stopAnalyzer: (() => void) | null = null;
    const releaseAnalyzer = () => {
      analyzerGeneration++;
      analyzerRequested = false;
      stopAnalyzer?.();
      stopAnalyzer = null;
    };
    const controller = new VoiceSession({
      create: () => { const Ctor = getRecognizerCtor(); return Ctor ? new Ctor() : null; },
      permission: async () => {
        if (!getRecognizerCtor()) throw new DOMException("Unavailable", "unsupported");
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new DOMException("Requires HTTPS", "insecure");
        return navigator.mediaDevices.getUserMedia({ audio: true });
      },
      onChange: (snapshot) => {
        if (disposed) return;
        setVoice(snapshot);
        if (["idle", "stopped", "error", "permission"].includes(snapshot.phase)) {
          releaseAnalyzer();
          setMicLevel(0);
          setTone("");
        } else if (["wake-listening", "capturing"].includes(snapshot.phase) && !analyzerRequested) {
          analyzerRequested = true;
          const generation = analyzerGeneration;
          void createToneAnalyzer((level, value) => {
            if (!disposed && generation === analyzerGeneration) { setMicLevel(level); setTone(value); }
          }).then((stop) => {
            if (disposed || generation !== analyzerGeneration) stop();
            else stopAnalyzer = stop;
          }).catch(() => { /* Recognition remains useful without the optional meter. */ });
        }
      },
      onCommand: (command) => latest.current.onCommand(command),
      onInterrupt: () => latest.current.onInterrupt(),
      isOccupied: () => latest.current.isOccupied(),
    });
    session.current = controller;
    return () => { disposed = true; controller.stop(); releaseAnalyzer(); session.current = null; };
  }, []);

  useEffect(() => { session.current?.stop(); }, [options.phrase, options.language]);
  const stopListening = useCallback(() => session.current?.stop(), []);
  const startListening = useCallback((mode: VoiceMode) => {
    const { phrase, language } = latest.current;
    void session.current?.start(mode, phrase, language === "auto" ? "en-IN" : langToBcp47(language));
  }, []);
  return { voice, micLevel, tone, startListening, stopListening };
}
