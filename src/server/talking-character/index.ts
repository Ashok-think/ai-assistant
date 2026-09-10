import "server-only";
import type { TalkingCharacterProvider } from "./provider";
import { LocalTalkingCharacterProvider } from "./local-provider";
import { RemoteTalkingCharacterProvider } from "./remote-provider";

export * from "./provider";

/**
 * Selects the talking-character provider from env:
 *   TALKING_CHARACTER_PROVIDER = local | remote   (default: remote if a URL is set, else local)
 * The rest of the app only ever imports getTalkingProvider() — engines stay swappable.
 */
export function getTalkingProvider(): TalkingCharacterProvider {
  const pref = (process.env.TALKING_CHARACTER_PROVIDER || "").toLowerCase();
  if (pref === "local") return new LocalTalkingCharacterProvider();
  if (pref === "remote") return new RemoteTalkingCharacterProvider();
  // Auto: prefer remote when configured, otherwise local (which will report unavailable honestly).
  return process.env.REMOTE_LIPSYNC_URL ? new RemoteTalkingCharacterProvider() : new LocalTalkingCharacterProvider();
}
