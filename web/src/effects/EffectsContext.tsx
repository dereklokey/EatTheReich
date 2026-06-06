import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Reduce-effects control (DESIGN.md §4 guardrail / §9). The hot "spectacle" layer is
 * opt-out: every effect is gated behind this so it can be added *behind* the toggle
 * rather than retrofitted. Default follows the OS `prefers-reduced-motion`; the user's
 * explicit choice (if any) is remembered in localStorage and wins.
 *
 * The state is published to CSS as `<html data-effects="full|reduced">` so plain CSS
 * (theme.css) strips grain/shake/motion, and to JS via the hook so Motion components
 * can skip heavy work.
 */
interface EffectsState {
  reduced: boolean;
  setReduced: (v: boolean) => void;
  toggle: () => void;
}

const EffectsCtx = createContext<EffectsState | null>(null);
const STORAGE_KEY = "etr.effects.reduced";

function prefersReduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function initialReduced(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return prefersReduced();
}

export function EffectsProvider({ children }: { children: ReactNode }) {
  const [reduced, setReducedState] = useState<boolean>(initialReduced);

  const setReduced = useCallback((v: boolean) => {
    setReducedState(v);
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  }, []);

  const toggle = useCallback(() => setReduced(!reduced), [reduced, setReduced]);

  useEffect(() => {
    document.documentElement.dataset.effects = reduced ? "reduced" : "full";
  }, [reduced]);

  const value = useMemo<EffectsState>(
    () => ({ reduced, setReduced, toggle }),
    [reduced, setReduced, toggle],
  );

  return <EffectsCtx.Provider value={value}>{children}</EffectsCtx.Provider>;
}

export function useEffects(): EffectsState {
  const ctx = useContext(EffectsCtx);
  if (!ctx) throw new Error("useEffects must be used within EffectsProvider");
  return ctx;
}
