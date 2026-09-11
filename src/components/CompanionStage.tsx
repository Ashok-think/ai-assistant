"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import CharacterAvatar, { type AvatarEmotion } from "./CharacterAvatar";
import Live2DCharacter, { type Live2DHandle, type CharacterRenderState } from "./Live2DCharacter";
import type { MouthFrame } from "@/lib/voice-client";

const fetchRig = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Character detection unavailable");
  return response.json() as Promise<{ present: boolean; modelUrl: string | null }>;
};

export default function CompanionStage({ emotion, state, talking, listening, mouth, lipSync, browserVoice }: {
  emotion: AvatarEmotion; state: CharacterRenderState; talking: boolean; listening: boolean;
  mouth: MouthFrame; lipSync: boolean; browserVoice: boolean;
}) {
  const { data } = useSWR("/api/character/live2d-status", fetchRig, { revalidateOnFocus: false });
  const rig = useRef<Live2DHandle>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const onStatus = useCallback((status: string) => setRendererReady(status === "ready"), []);
  useEffect(() => {
    if (!rendererReady || !data?.modelUrl || !rig.current) return;
    let active = true;
    rig.current.loadModel(data.modelUrl).then(() => { if (active) setModelReady(true); }).catch(() => { if (active) setModelReady(false); });
    return () => { active = false; };
  }, [rendererReady, data?.modelUrl]);
  useEffect(() => { rig.current?.setState(state); }, [state, modelReady]);
  useEffect(() => { rig.current?.setEmotion(emotion); }, [emotion, modelReady]);
  useEffect(() => { rig.current?.setLipSync(lipSync && !browserVoice); rig.current?.setMouth(mouth); }, [mouth, lipSync, browserVoice, modelReady]);
  return (
    <div className="companion-stage">
      <div className="stage-caption font-mono"><span>CHARACTER ENGINE</span><span>{state.toUpperCase()}</span></div>
      <div className="stage-avatar" role="img" aria-label={`Companion character, ${state}, ${emotion} expression`}>
        {data?.present && data.modelUrl && <div hidden={!modelReady}><Live2DCharacter ref={rig} size={270} onStatus={onStatus} /></div>}
        {!modelReady && <CharacterAvatar color="#326b79" accent="#79dce8" emoji="" emotion={emotion} talking={talking && !browserVoice} listening={listening} size={270} mouthLevel={lipSync ? mouth.level : 0} viseme={mouth.viseme} />}
      </div>
      <div className="stage-caption stage-bottom"><span>{modelReady ? "Live2D · live renderer" : "Procedural avatar · fallback"}</span><Link href="/characters">{modelReady ? "Customize" : "Character rig required"}</Link></div>
    </div>
  );
}
