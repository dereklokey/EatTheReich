import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { Allocation } from "@shared/engine/allocate.js";
import { applyOneAllocation, emptyAccumulator } from "@shared/engine/allocate.js";
import type { SeatId } from "@shared/events/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { seatName } from "@/game/seats";
import { Die, tiltFor } from "@/components/dice/Die";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import "./last-stand.css";

/**
 * LAST STAND (RULES §5, rulebook p36, DESIGN.md §6 — "the app's biggest moment"). A
 * dying vampire rolls a final 8d6 and applies them to the current Objectives and Threats
 * however they like, narrates a final sacrifice, and retires. No GM pool, no discard, no
 * Defend/Feed — every die counts. Slow, heavy, funereal beats. Earn it.
 */
type Assignment = Allocation | null;

export function LastStand({
  state,
  send,
  mySeat,
}: {
  state: GameState;
  send: (i: Intent) => void;
  mySeat: SeatId | null;
}) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const turn = state.currentTurn;
  const seat = turn?.seat;
  const sheet = seat ? CHARACTERS_BY_ID[seat] : undefined;
  const survivors = turn?.survivors ?? [];
  // The Last Stand is the dying vampire's own moment (RULES §5) — only they roll the
  // final 8d6 and place the blows. The GM watches, same as the resolution theater
  // (issues #42/#43); Rewind is the GM's escape hatch (there's no cancel here).
  const canDrive = mySeat === seat;

  const [assign, setAssign] = useState<Assignment[]>([]);
  const [picked, setPicked] = useState<number | null>(null);

  const preview = useMemo(() => {
    const start = emptyAccumulator({ objectives: state.board.objectives, threats: state.board.threats }, 0);
    return assign.filter((a): a is Allocation => a !== null).reduce(applyOneAllocation, start);
  }, [assign, state.board.objectives, state.board.threats]);

  if (!turn?.lastStand || !seat) return null;

  const rolled = survivors.length > 0;
  // Lazily size the assignment array to the rolled dice (survivors is empty pre-roll).
  if (rolled && assign.length !== survivors.length) setAssign(survivors.map(() => null));

  const place = (alloc: Omit<Allocation, "units">) => {
    if (picked === null) return;
    const die = survivors[picked];
    if (!die) return;
    setAssign((cur) => cur.map((a, i) => (i === picked ? { ...alloc, units: die.units } : a)));
    setPicked(null);
    play(alloc.kind === "eliminate" ? "hit" : "stamp");
  };
  const unassign = (i: number) => setAssign((cur) => cur.map((a, idx) => (idx === i ? null : a)));

  const allocations = assign.filter((a): a is Allocation => a !== null);
  const pickedDie = picked !== null ? survivors[picked] : undefined;
  const objLive = preview.board.objectives;
  // Staged threats (issue #12) aren't in play, so they can't be targeted even on the way out.
  const thrLive = preview.board.threats.filter((t) => t.active !== false);

  return (
    <div className="last-stand">
      <div className="last-stand__inner">
        <div className="last-stand__title">LAST STAND</div>
        <div className="last-stand__name mt-2 text-lg">
          {seatName(seat)} — {sheet?.lastStand ?? "a final sacrifice"}
        </div>
        <p className="last-stand__sub mono text-xs mt-2 max-w-md mx-auto">
          {rolled
            ? "Apply the bones to the Objectives and Threats however you like. Then describe how you go out — and retire."
            : "All six wounds are marked. Cast the bones and make your death mean something."}
        </p>

        {!rolled ? (
          <div className="mt-8">
            {canDrive ? (
              <button
                className="ls-detonator"
                onClick={() => {
                  play("concussion");
                  play("clatter");
                  send({ kind: "last_stand_roll" });
                }}
              >
                Roll the bones · 8d6
              </button>
            ) : (
              <p className="mono text-sm last-stand__sub">{seatName(seat)} is making their last stand…</p>
            )}
          </div>
        ) : (
          <>
            {/* The final pool — assembles in slow, heavy beats. */}
            <div className="ls-tray mt-7">
              {survivors.map((die, i) => {
                const spent = assign[i] != null;
                const dieEl = (
                  <button
                    className={`ls-die ${picked === i ? "ls-die--selected" : ""} ${spent ? "ls-die--spent" : ""}`}
                    disabled={!canDrive}
                    onClick={() => (spent ? unassign(i) : setPicked(i))}
                    title={spent ? "tap to free" : "tap to pick up"}
                  >
                    <Die kind="player" value={die.face} state={die.kind === "crit" ? "critical" : "success"} tilt={tiltFor(i)} />
                  </button>
                );
                return reduced ? (
                  <span key={i}>{dieEl}</span>
                ) : (
                  <motion.span
                    key={i}
                    initial={{ y: -90, opacity: 0, scale: 1.15 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.16, type: "spring", stiffness: 220, damping: 26 }}
                  >
                    {dieEl}
                  </motion.span>
                );
              })}
            </div>

            <p className="mono text-xs last-stand__sub mt-2">
              {pickedDie
                ? `Placing ${pickedDie.units} — choose where it falls`
                : canDrive
                  ? "Tap a die, then a target. Every die counts."
                  : `Watching ${seatName(seat)}’s final blows.`}
            </p>

            {/* Targets — only Objectives and Threats (no Defend/Feed; you're dying). */}
            <div className="mt-5 grid gap-2 sm:grid-cols-2 text-left">
              {objLive.map((o) => (
                <LsTarget
                  key={o.id}
                  armed={picked !== null}
                  label={o.name}
                  sub={`Objective · rating ${o.rating}${o.challenge ? ` · challenge ${o.challenge}` : ""}`}
                  onClick={() => place({ kind: "advance", targetId: o.id })}
                />
              ))}
              {thrLive.map((t) => (
                <LsTarget
                  key={t.id}
                  armed={picked !== null}
                  label={t.name}
                  sub={`Threat · rating ${t.rating} · ATK ${t.attack}${t.challenge ? ` · challenge ${t.challenge}` : ""}`}
                  onClick={() => place({ kind: "eliminate", targetId: t.id })}
                />
              ))}
            </div>

            {canDrive && (
              <div className="mt-7">
                <button
                  className="ls-detonator"
                  onClick={() => {
                    play("crit");
                    send({ kind: "last_stand_commit", allocations });
                  }}
                  title="Apply the final blows and retire from the game"
                >
                  Go out with a bang
                </button>
                <p className="mono text-[0.65rem] last-stand__sub mt-2">
                  {allocations.length}/{survivors.length} dice placed · unplaced dice are lost to the dark
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LsTarget({ label, sub, onClick, armed }: { label: string; sub: string; onClick: () => void; armed: boolean }) {
  return (
    <button className={`ls-target ${armed ? "ls-target--armed" : ""}`} onClick={onClick}>
      <div className="display text-base">{label}</div>
      <div className="mono text-[0.65rem]" style={{ color: "rgba(244,217,160,0.6)" }}>{sub}</div>
    </button>
  );
}
