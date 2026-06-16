import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DieFace } from "@shared/domain/types.js";
import { GoDiceManager, type GoDieInfo, type GoDiceRoll } from "./GoDice.js";

/**
 * App-level GoDice link (issue #50). One shared `GoDiceManager` lives here so a pairing made
 * during one Reich roll is still connected for the next — the GM connects once a session, not
 * once a turn. The capture tray in the resolution theater consumes this; nothing else needs it.
 *
 * State is a thin mirror of the manager (the connected-dice list + connect status); roll events
 * are delivered by subscription rather than state so a fast handful doesn't thrash React.
 */
interface GoDiceState {
  /** Web Bluetooth is usable in this browser (else only the test path works). */
  supported: boolean;
  dice: GoDieInfo[];
  connecting: boolean;
  error: string | null;
  /** Open the pairing chooser (must be from a click). Adds a die on success. */
  connect: () => Promise<void>;
  disconnectAll: () => void;
  /** Subscribe to physical (or simulated) rolls; returns an unsubscribe. */
  subscribeRolls: (cb: (roll: GoDiceRoll) => void) => () => void;
  /** Subscribe to any live traffic from a die (movement/rest/battery) — the "it's talking now"
   *  cue used to flash a die's tag when you wobble it. Returns an unsubscribe. */
  subscribeActivity: (cb: (deviceId: string) => void) => () => void;
  /** Inject a synthetic roll for testing without hardware. */
  simulateRoll: (value?: DieFace) => void;
}

const GoDiceCtx = createContext<GoDiceState | null>(null);

export function GoDiceProvider({ children }: { children: ReactNode }) {
  const managerRef = useRef<GoDiceManager | null>(null);
  if (managerRef.current === null) managerRef.current = new GoDiceManager();
  const manager = managerRef.current;

  const [dice, setDice] = useState<GoDieInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror the manager's device list into React on every change.
  useEffect(() => manager.subscribe({ onChange: () => setDice(manager.dice()) }), [manager]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      await manager.connect();
    } catch (e) {
      // A user cancelling the chooser throws too — keep that quiet-ish but surfaced.
      const msg = e instanceof Error ? e.message : "couldn't connect";
      setError(/cancelled|user/i.test(msg) ? "pairing cancelled" : msg);
    } finally {
      setConnecting(false);
    }
  }, [manager]);

  const disconnectAll = useCallback(() => manager.disconnectAll(), [manager]);
  const subscribeRolls = useCallback(
    (cb: (roll: GoDiceRoll) => void) => manager.subscribe({ onRoll: cb }),
    [manager],
  );
  const subscribeActivity = useCallback(
    (cb: (deviceId: string) => void) => manager.subscribe({ onActivity: cb }),
    [manager],
  );
  const simulateRoll = useCallback((value?: DieFace) => manager.simulateRoll(value), [manager]);

  const value = useMemo<GoDiceState>(
    () => ({
      supported: manager.isSupported(),
      dice,
      connecting,
      error,
      connect,
      disconnectAll,
      subscribeRolls,
      subscribeActivity,
      simulateRoll,
    }),
    [manager, dice, connecting, error, connect, disconnectAll, subscribeRolls, subscribeActivity, simulateRoll],
  );

  return <GoDiceCtx.Provider value={value}>{children}</GoDiceCtx.Provider>;
}

export function useGoDice(): GoDiceState {
  const ctx = useContext(GoDiceCtx);
  if (!ctx) throw new Error("useGoDice must be used within GoDiceProvider");
  return ctx;
}
