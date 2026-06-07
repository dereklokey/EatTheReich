import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState, TurnState } from "@shared/state/types.js";
import { anathemaInPlay } from "@shared/domain/types.js";
import { seatName } from "@/game/seats";
import { TheaterShell } from "./Theater";
import { RollReveal } from "./RollReveal";
import { DiceArena, type ThrowSpec } from "./DiceArena";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";

/**
 * The roll, staged as a craps-table throw (issue #5). The active player's dice are flung
 * across the *live board* and bounce to rest where they fall — their moment, watched by the
 * whole table. Then the **Reich answers**: the GM throws the enemy pool the same way. Both
 * sets sit a beat so everyone reads them, then fade out and the dark **results panel** rises
 * for the discard/allocate step. Reduce-effects skips all of it for a calm, static readout.
 */
type Phase = "player" | "await-reich" | "reich" | "rest" | "fade" | "results";

// Rolls whose throw has already played on THIS client. A peek/resume or a mid-turn
// reconnect then drops straight to the results panel instead of re-throwing the dice.
const shownThrows = new Set<string>();

export function RollSequence(props: {
  turn: TurnState;
  state: GameState;
  canDrive: boolean;
  isGm: boolean;
  canFlashback: boolean;
  onFlashback: () => void;
  onRollGm: () => void;
  onResolve: () => void;
  onMinimize: () => void;
  onCancel: () => void;
}) {
  const { reduced } = useEffects();
  const { turn, state, canDrive, isGm, canFlashback, onFlashback, onRollGm, onResolve, onMinimize, onCancel } = props;
  // Vampirjäger 'Anathema' (#21): while it's in play, the Reich's 6s score 2 successes — so the
  // results readout reports the boosted hit count (the same predicate the server tallies with).
  const anathema = anathemaInPlay(state.board.threats);

  // Reduced effects: no spectacle. The dark results panel runs the two-beat (player rolls,
  // then the GM rolls) with static dice — exactly what the calm path always did.
  if (reduced) {
    return (
      <TheaterShell turn={turn} canDrive={canDrive} onMinimize={onMinimize} onCancel={onCancel}>
        <RollReveal turn={turn} canDrive={canDrive} isGm={isGm} anathema={anathema} canFlashback={canFlashback} onFlashback={onFlashback} onRollGm={onRollGm} onResolve={onResolve} />
      </TheaterShell>
    );
  }

  return (
    <FullSequence
      turn={turn}
      anathema={anathema}
      canDrive={canDrive}
      isGm={isGm}
      canFlashback={canFlashback}
      onFlashback={onFlashback}
      onRollGm={onRollGm}
      onResolve={onResolve}
      onMinimize={onMinimize}
      onCancel={onCancel}
    />
  );
}

function FullSequence({
  turn,
  anathema,
  canDrive,
  isGm,
  canFlashback,
  onFlashback,
  onRollGm,
  onResolve,
  onMinimize,
  onCancel,
}: {
  turn: TurnState;
  anathema: boolean;
  canDrive: boolean;
  isGm: boolean;
  canFlashback: boolean;
  onFlashback: () => void;
  onRollGm: () => void;
  onResolve: () => void;
  onMinimize: () => void;
  onCancel: () => void;
}) {
  const { play } = useSound();

  const player = turn.playerDice ?? [];
  const gm = turn.gmDice; // undefined until the GM rolls
  const gmPool = turn.gmPoolSize ?? 0;

  const throwKey = useMemo(() => `${turn.seat}:${player.join(",")}`, [turn.seat, player]);
  const alreadyShown = useRef(shownThrows.has(throwKey));
  const [phase, setPhase] = useState<Phase>(alreadyShown.current ? "results" : "player");
  const [playerSettled, setPlayerSettled] = useState(false);
  const [reichSettled, setReichSettled] = useState(false);

  useEffect(() => {
    shownThrows.add(throwKey);
  }, [throwKey]);

  const throws: ThrowSpec[] = useMemo(() => {
    const list: ThrowSpec[] = [{ id: "player", kind: "player", dice: player }];
    if (gm !== undefined) list.push({ id: "reich", kind: "gm", dice: gm });
    return list;
  }, [player, gm]);

  const onThrowSettled = useCallback(
    (id: string) => {
      if (id === "player") {
        const anyCrit = player.includes(6);
        const anySucc = player.some((f) => f >= 4);
        play(anyCrit ? "crit" : anySucc ? "success" : "discard");
        setPlayerSettled(true);
      } else if (id === "reich") {
        if ((gm ?? []).some((f) => f >= 4)) play("success");
        setReichSettled(true);
      }
    },
    [player, gm, play],
  );

  // Throw sounds as each pool takes flight.
  useEffect(() => {
    if (!alreadyShown.current) {
      play("concussion");
      play("clatter");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase === "reich" && (gm?.length ?? 0) > 0) {
      play("concussion");
      play("clatter");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // After the player's dice rest: wait for the GM, or (if the Reich already rolled —
  // uncontested, or a fast GM) move straight on to its throw.
  useEffect(() => {
    if (phase === "player" && playerSettled) setPhase(gm !== undefined ? "reich" : "await-reich");
  }, [phase, playerSettled, gm]);
  // The GM rolled while we were waiting → throw the Reich.
  useEffect(() => {
    if (phase === "await-reich" && gm !== undefined) setPhase("reich");
  }, [phase, gm]);
  // The Reich's dice have rested → hold, fade, then raise the results panel.
  useEffect(() => {
    if (phase === "reich" && reichSettled) setPhase("rest");
  }, [phase, reichSettled]);
  useEffect(() => {
    if (phase === "rest") {
      const t = setTimeout(() => setPhase("fade"), 2600);
      return () => clearTimeout(t);
    }
    if (phase === "fade") {
      const t = setTimeout(() => setPhase("results"), 650);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // Backstop: never strand the turn on the spectacle. (await-reich is excluded — it's a
  // legitimate, open-ended wait on a human GM, and the results panel can roll there too.)
  useEffect(() => {
    if (phase === "await-reich" || phase === "results") return;
    const t = setTimeout(() => setPhase("results"), 9000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "results") {
    return (
      <TheaterShell turn={turn} canDrive={canDrive} onMinimize={onMinimize} onCancel={onCancel}>
        <RollReveal turn={turn} canDrive={canDrive} isGm={isGm} anathema={anathema} canFlashback={canFlashback} onFlashback={onFlashback} onRollGm={onRollGm} onResolve={onResolve} />
      </TheaterShell>
    );
  }

  return (
    <>
      <DiceArena throws={throws} fading={phase === "fade"} onThrowSettled={onThrowSettled} />
      <div className="roll-stage__head">
        {seatName(turn.seat)}’s roll
        <small>{phase === "await-reich" ? "the bones are cast — the Reich answers" : "the bones are in the air"}</small>
      </div>
      {phase === "await-reich" && (
        <div className="roll-stage__control">
          {isGm ? (
            <button className="detonator" onClick={onRollGm} title="Throw the Reich’s dice">
              Roll the Reich · {gmPool}
            </button>
          ) : (
            <p className="mono text-sm text-paper">The GM rolls the Reich’s {gmPool} {gmPool === 1 ? "die" : "dice"}…</p>
          )}
          {canDrive && (
            <button className="mono text-xs underline text-paper-fade" onClick={onCancel}>
              cancel turn
            </button>
          )}
        </div>
      )}
    </>
  );
}
