import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { TurnState } from "@shared/state/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { Die, tiltFor, type DieVisualState } from "@/components/dice/Die";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";

/**
 * ROLL → reveal (RULES §4, DESIGN.md §6). The dice land with a concussion (shake +
 * muzzle bloom), then — staggered, not all at once — tumble into the tray and settle
 * neutral. After a beat of suspense the values resolve: successes (4–5) flare
 * hazard-yellow, the crit (6) detonates crimson with a short slow-mo hold, and
 * sub-threshold dice are about to be discarded. The driver then resolves the discard.
 */
function playerState(face: DieFace): DieVisualState {
  if (face === 6) return "critical";
  if (face >= 4) return "success";
  return "normal";
}

/** Staggered tumble-in for one die; the entry transform lives on this wrapper alone. */
function entry(i: number) {
  return {
    initial: { y: -130, rotate: -24, opacity: 0, scale: 1.08 },
    animate: { y: 0, rotate: 0, opacity: 1, scale: 1 },
    transition: { delay: i * 0.07, type: "spring" as const, stiffness: 520, damping: 24 },
  };
}

export function RollReveal({
  turn,
  canDrive,
  onResolve,
}: {
  turn: TurnState;
  canDrive: boolean;
  onResolve: () => void;
}) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const [boom, setBoom] = useState(!reduced);
  const [revealed, setRevealed] = useState(reduced);
  const seen = useRef(false);

  const player = turn.playerDice ?? [];
  const gm = turn.gmDice ?? [];
  const gmHits = gm.filter((f) => f >= 4).length;
  const anyCrit = player.includes(6);

  useEffect(() => {
    if (seen.current) return;
    seen.current = true;
    // The roll lands (sound is independent of reduce-effects — it has its own mute).
    play("concussion");
    play("clatter");
    const anySucc = player.some((f) => f >= 4);
    // Values resolve only after the dice have tumbled in — that suspense is the drama.
    const revealAt = reduced ? 0 : Math.min(player.length * 70 + 280, 900);
    const revealT = setTimeout(() => {
      setRevealed(true);
      play(anyCrit ? "crit" : anySucc ? "success" : "discard");
    }, revealAt);
    const settle = reduced ? undefined : setTimeout(() => setBoom(false), 520);
    return () => {
      clearTimeout(revealT);
      if (settle) clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="theater__phase text-sm">The roll</div>

      <div className={`relative mt-3 ${boom ? "shake" : ""}`}>
        {boom && <span className="flash-bloom" />}
        <div className="mono text-xs text-paper-fade mb-1">Your dice</div>
        <div className="tray">
          {player.map((face, i) =>
            reduced ? (
              <Die key={i} kind="player" value={face} state={playerState(face)} tilt={tiltFor(i)} />
            ) : (
              <motion.div key={i} {...entry(i)}>
                <div className={revealed && face === 6 ? "crit-pop" : ""}>
                  <Die kind="player" value={face} state={revealed ? playerState(face) : "normal"} tilt={tiltFor(i)} />
                </div>
              </motion.div>
            ),
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="mono text-xs text-paper-fade mb-1">
          The Reich’s dice — <span className="text-blood">{gmHits} success{gmHits === 1 ? "" : "es"}</span>
        </div>
        <div className="tray">
          {gm.map((face, i) => {
            const gmState = revealed && face >= 4 ? "success" : "normal";
            return reduced ? (
              <Die key={i} kind="gm" value={face} state={face >= 4 ? "success" : "normal"} tilt={tiltFor(i + 3)} />
            ) : (
              <motion.div key={i} {...entry(player.length + i)}>
                <Die kind="gm" value={face} state={gmState} tilt={tiltFor(i + 3)} />
              </motion.div>
            );
          })}
        </div>
      </div>

      {canDrive && (
        <button
          className="detonator mt-6"
          onClick={() => {
            play("discard");
            onResolve();
          }}
        >
          Discard &amp; resolve
        </button>
      )}
    </div>
  );
}
