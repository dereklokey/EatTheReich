import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { SoundKit, type Cue } from "./sound";

/**
 * Sound control (DESIGN.md §7). Default-off and synthesized on demand; the first
 * enable happens inside a user gesture (the toggle), satisfying browser autoplay
 * policy. Independent of reduce-effects — it has its own mute — so a player can keep
 * the visual calm layer but still hear the hits, or vice versa.
 */
interface SoundState {
  enabled: boolean;
  toggle: () => void;
  play: (cue: Cue) => void;
}

const SoundCtx = createContext<SoundState | null>(null);
const STORAGE_KEY = "etr.sound.enabled";

export function SoundProvider({ children }: { children: ReactNode }) {
  const kitRef = useRef<SoundKit | null>(null);
  if (!kitRef.current) kitRef.current = new SoundKit();
  const [enabled, setEnabled] = useState(false);

  const toggle = useCallback(() => {
    const kit = kitRef.current!;
    if (enabled) {
      kit.disable();
      setEnabled(false);
      localStorage.setItem(STORAGE_KEY, "0");
    } else {
      kit.enable(); // user gesture → safe to create/resume AudioContext
      setEnabled(true);
      localStorage.setItem(STORAGE_KEY, "1");
    }
  }, [enabled]);

  const play = useCallback((cue: Cue) => kitRef.current?.play(cue), []);

  const value = useMemo<SoundState>(() => ({ enabled, toggle, play }), [enabled, toggle, play]);
  return <SoundCtx.Provider value={value}>{children}</SoundCtx.Provider>;
}

export function useSound(): SoundState {
  const ctx = useContext(SoundCtx);
  if (!ctx) throw new Error("useSound must be used within SoundProvider");
  return ctx;
}
