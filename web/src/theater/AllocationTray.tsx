import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GameState, TurnState, CharacterRuntime } from "@shared/state/types.js";
import type { Allocation } from "@shared/engine/allocate.js";
import { applyOneAllocation, emptyAccumulator } from "@shared/engine/allocate.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { Die, tiltFor } from "@/components/dice/Die";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import type { Cue } from "@/effects/sound";

/**
 * ALLOCATE (RULES §4, DESIGN.md §6). Each surviving die is placed on a target —
 * Advance an Objective, Eliminate a Threat, Defend (knock off GM Attack dice), Feed
 * (+Blood), or activate a SPECIAL (criticals only). Tap a die, then tap a target
 * (drag's tap fallback). A live local preview folds the same engine the server uses,
 * so the numbers match before "Lock in" commits and runs the injury check.
 *
 * Dropping a die fires its spectacle (§6): arterial spray + recoil on Eliminate (a
 * heavier burst on the kill), a hazard chunk on Advance, the incoming Attack dice
 * physically knocked off the table on Defend, a crimson screen-flood on Feed, and a
 * full-screen blackletter stamp on a SPECIAL. All gated by reduce-effects.
 */
type Assignment = Allocation | null;

/** A per-target one-shot burst, re-keyed by `seq` so re-placing replays it. */
type CardFx = { seq: number; kind: "spray" | "kill" | "chunk" };

export function AllocationTray({
  turn,
  state,
  char,
  canDrive,
  onLockIn,
  onAddDice,
}: {
  turn: TurnState;
  state: GameState;
  char: CharacterRuntime;
  canDrive: boolean;
  onLockIn: (allocations: Allocation[]) => void;
  onAddDice: (count: number, label?: string) => void;
}) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const survivors = turn.survivors ?? [];
  const gmRemaining = turn.gmDiceRemaining ?? 0;
  const [assign, setAssign] = useState<Assignment[]>(() => survivors.map(() => null));
  const [picked, setPicked] = useState<number | null>(null);

  // Survivors can GROW mid-allocation when bonus dice land (RULES §4) — extend the
  // assignment array for the new dice while preserving existing placements.
  if (assign.length !== survivors.length) {
    setAssign((cur) => survivors.map((_, i) => cur[i] ?? null));
  }

  // Flag freshly-added dice so they drop in (and clatter) for one beat.
  const seenLen = useRef(survivors.length);
  const [enterFrom, setEnterFrom] = useState<number | null>(null);
  useEffect(() => {
    if (survivors.length > seenLen.current) {
      if (!reduced) setEnterFrom(seenLen.current);
      play("clatter");
      seenLen.current = survivors.length;
      const t = setTimeout(() => setEnterFrom(null), 650);
      return () => clearTimeout(t);
    }
    seenLen.current = survivors.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survivors.length]);

  // Transient spectacle (§6). Never cleared — overwritten and re-keyed by an
  // incrementing seq so the same target replays its burst on each new hit.
  const fxSeq = useRef(0);
  const [cardFx, setCardFx] = useState<Record<string, CardFx>>({});
  const [feedSeq, setFeedSeq] = useState(0);
  const [special, setSpecial] = useState<{ seq: number; name: string } | null>(null);

  const ALLOC_CUE: Record<Allocation["kind"], Cue> = {
    advance: "stamp",
    eliminate: "hit",
    defend: "defend",
    feed: "feed",
    special: "crit",
  };

  const sheet = CHARACTERS_BY_ID[turn.seat];
  const specials = [
    ...(sheet?.abilities ?? []),
    ...(sheet?.advances ?? []).filter((p) => char.unlockedAdvances.includes(p.id)),
  ].filter((p) => p.mechanic === "special");

  // Live preview via the real engine (challenge soak, rating clamp, GM-die removal).
  const preview = useMemo(() => {
    const start = emptyAccumulator({ objectives: state.board.objectives, threats: state.board.threats }, gmRemaining);
    return assign.filter((a): a is Allocation => a !== null).reduce(applyOneAllocation, start);
  }, [assign, state.board.objectives, state.board.threats, gmRemaining]);

  // The incoming GM Attack: gmSuccessCount dice (post-passive), drawn from the rolled
  // successes; Defend allocations shave the live count, knocking dice off the table.
  const gmSuccessCount = turn.gmSuccessCount ?? gmRemaining;
  const gmSuccessFaces = (turn.gmDice ?? []).filter((f) => f >= 4);
  const incoming = Array.from({ length: gmSuccessCount }, (_, i) => gmSuccessFaces[i] ?? 5);

  const fireCard = (id: string, kind: CardFx["kind"]) => {
    if (reduced) return;
    setCardFx((m) => ({ ...m, [id]: { seq: ++fxSeq.current, kind } }));
  };

  const place = (alloc: Omit<Allocation, "units">) => {
    if (picked === null) return;
    const die = survivors[picked];
    if (!die) return;
    const units = die.units;
    setAssign((cur) => cur.map((a, i) => (i === picked ? { ...alloc, units } : a)));
    setPicked(null);
    play(ALLOC_CUE[alloc.kind]);

    // Spectacle: branch on what the drop does in the fiction.
    if (alloc.kind === "eliminate" && alloc.targetId) {
      // Will this die take the Threat to 0? Challenge soaks first (RULES §6), so a
      // die eaten by Challenge isn't a kill — mirror the engine to avoid a false burst.
      const thr = preview.board.threats.find((t) => t.id === alloc.targetId);
      let killed = false;
      if (thr) {
        const challengeLeft = Math.max(0, (thr.challenge ?? 0) - (preview.challengeConsumed[thr.id] ?? 0));
        const ratingDrop = Math.max(0, units - challengeLeft);
        killed = thr.rating - ratingDrop <= 0;
      }
      fireCard(alloc.targetId, killed ? "kill" : "spray");
    } else if (alloc.kind === "advance" && alloc.targetId) {
      fireCard(alloc.targetId, "chunk");
    } else if (alloc.kind === "feed" && !reduced) {
      setFeedSeq((n) => n + 1);
    } else if (alloc.kind === "special" && alloc.specialId && !reduced) {
      const name = specials.find((s) => s.id === alloc.specialId)?.name ?? "SPECIAL";
      setSpecial({ seq: ++fxSeq.current, name });
    }
  };

  const unassign = (i: number) => setAssign((cur) => cur.map((a, idx) => (idx === i ? null : a)));

  const allocations = assign.filter((a): a is Allocation => a !== null);
  const unplaced = assign.filter((a) => a === null).length;
  const pickedDie = picked !== null ? survivors[picked] : undefined;

  const objLive = preview.board.objectives;
  // Staged threats (issue #12) aren't in the fight, so they're not allocatable targets.
  const thrLive = preview.board.threats.filter((t) => t.active !== false);

  return (
    <div>
      <div className="theater__phase text-sm">Allocate your dice</div>

      {/* Surviving dice — tap one, then tap a target. Tap a placed die to free it. */}
      <div className="tray mt-3">
        {survivors.map((die, i) => {
          const placed = assign[i];
          return (
            <button
              key={i}
              className={`die-pick ${picked === i ? "die-pick--selected" : ""} ${placed ? "opacity-40" : ""}`}
              disabled={!canDrive}
              onClick={() => (placed ? unassign(i) : setPicked(i))}
              title={placed ? `placed: ${placed.kind} — tap to free` : "tap to pick up"}
            >
              <Die kind="player" value={die.face} state={die.kind === "crit" ? "critical" : "success"} tilt={tiltFor(i)} entering={enterFrom !== null && i >= enterFrom} />
            </button>
          );
        })}
        {survivors.length === 0 && <span className="mono text-paper-fade italic">No survivors — all dice discarded.</span>}
      </div>

      {canDrive && <BonusDiceControl onAdd={onAddDice} />}

      <p className="mono text-xs text-paper-fade mt-1">
        {pickedDie
          ? `Placing a ${pickedDie.kind} (${pickedDie.units} unit${pickedDie.units > 1 ? "s" : ""}) — tap a target`
          : canDrive
            ? "Tap a die to pick it up."
            : "Watching the active player allocate."}
      </p>

      {/* Incoming GM Attack — physically knocked off the table by Defend (§6). */}
      {incoming.length > 0 && (
        <div className="mt-4">
          <div className="mono text-xs text-paper-fade mb-1">
            Incoming —{" "}
            <span className="text-blood">
              {preview.gmDiceRemaining} Attack{preview.gmDiceRemaining === 1 ? "" : "s"}
            </span>{" "}
            {preview.gmDiceRemaining === 0 ? "(all defended)" : "will strike"}
          </div>
          <div className="gm-attack-row">
            <AnimatePresence>
              {incoming.slice(0, preview.gmDiceRemaining).map((face, i) => (
                <motion.div
                  key={i}
                  initial={false}
                  exit={
                    reduced
                      ? { opacity: 0 }
                      : { x: 260, y: -50, rotate: 120, opacity: 0, transition: { duration: 0.4, ease: [0.2, 0.7, 0.2, 1] } }
                  }
                >
                  <Die kind="gm" value={face} state="success" tilt={tiltFor(i + 5)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Targets */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {objLive.map((o) => (
          <TargetCard
            key={o.id}
            fx={cardFx[o.id]}
            armed={picked !== null}
            label={o.name}
            sub={`Objective · rating ${o.rating}${o.challenge ? ` · challenge ${o.challenge}` : ""}`}
            onClick={() => place({ kind: "advance", targetId: o.id })}
          />
        ))}
        {thrLive.map((t) => (
          <TargetCard
            key={t.id}
            threat
            fx={cardFx[t.id]}
            armed={picked !== null}
            label={t.name}
            sub={`Threat · rating ${t.rating} · ATK ${t.attack}${t.challenge ? ` · challenge ${t.challenge}` : ""}`}
            onClick={() => place({ kind: "eliminate", targetId: t.id })}
          />
        ))}
        <TargetCard
          armed={picked !== null}
          label="Defend"
          sub={`Knock off GM Attack dice · ${preview.gmDiceRemaining} incoming`}
          onClick={() => place({ kind: "defend" })}
        />
        <TargetCard
          armed={picked !== null}
          label="Feed"
          sub={`Drink deep · +${preview.bloodGained} Blood (now ${Math.min(10, char.blood + preview.bloodGained)})`}
          onClick={() => place({ kind: "feed" })}
        />
        {specials.length > 0 && pickedDie?.kind === "crit" && (
          <div className="paper paper-tight sm:col-span-2">
            <div className="mono text-xs text-paper-fade mb-1">Activate a SPECIAL (critical)</div>
            <div className="flex flex-wrap gap-1.5">
              {specials.map((sp) => (
                <button
                  key={sp.id}
                  className="mono text-xs px-2 py-1 bg-dusk-mauve text-paper"
                  style={{ borderRadius: 2 }}
                  onClick={() => place({ kind: "special", specialId: sp.id })}
                  title={sp.text}
                >
                  {sp.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {canDrive && (
        <div className="mt-5 flex items-center gap-3">
          <span className="mono text-xs text-paper-fade">
            {unplaced > 0 ? `${unplaced} die${unplaced === 1 ? "" : "s"} unplaced` : "all dice placed"} ·{" "}
            {preview.gmDiceRemaining} GM dice will strike
          </span>
          <button
            className="detonator ml-auto"
            onClick={() => onLockIn(allocations)}
            title="Apply allocations, then run the injury check"
          >
            Lock in
          </button>
        </div>
      )}

      {/* Screen-level bursts. */}
      {feedSeq > 0 && <span key={`feed-${feedSeq}`} className="feed-vignette" />}
      {special && (
        <div key={`sp-${special.seq}`} className="special-stamp">
          <div className="special-stamp__name">{special.name}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Mid-allocation bonus dice (RULES §4 — "the pool is not frozen at roll time"). When a
 * new advantage is narrated and the GM confirms it, more dice are rolled straight into
 * the tray. Collapsed to a quiet link until needed, so it never competes with the dice.
 */
function BonusDiceControl({ onAdd }: { onAdd: (count: number, label?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState("");

  if (!open) {
    return (
      <button className="mono text-xs underline text-paper-fade mt-2" onClick={() => setOpen(true)} title="A newly narrated advantage rolls more dice into the tray (GM confirms)">
        ＋ bonus dice
      </button>
    );
  }
  const roll = () => {
    onAdd(count, label.trim() || undefined);
    setOpen(false);
    setLabel("");
    setCount(1);
  };
  return (
    <div className="paper paper-tight mt-2 flex flex-wrap items-center gap-2">
      <span className="mono text-[0.65rem] text-paper-fade">New advantage — GM grants</span>
      <div className="flex items-center gap-1">
        <button className="mono px-2 bg-night-top text-paper" style={{ borderRadius: 2 }} onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
        <span className="display text-base w-5 text-center">{count}</span>
        <button className="mono px-2 bg-night-top text-paper" style={{ borderRadius: 2 }} onClick={() => setCount((c) => Math.min(4, c + 1))}>+</button>
        <span className="mono text-[0.6rem] text-paper-fade">{count === 1 ? "die" : "dice"}</span>
      </div>
      <input
        className="mono text-xs bg-night-deep text-paper px-2 py-1 flex-1 min-w-24 border border-paper-shadow/30"
        style={{ borderRadius: 2 }}
        placeholder="reason (e.g. flanking)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && roll()}
      />
      <button className="detonator text-sm px-3 py-1" onClick={roll} title="Roll the bonus dice into the tray">
        Roll
      </button>
      <button className="mono text-xs underline text-paper-fade" onClick={() => setOpen(false)}>cancel</button>
    </div>
  );
}

function TargetCard({
  label,
  sub,
  onClick,
  armed,
  threat,
  fx,
}: {
  label: string;
  sub: string;
  onClick: () => void;
  armed: boolean;
  threat?: boolean;
  fx?: CardFx;
}) {
  const recoiling = fx && fx.kind !== "chunk";
  return (
    <button
      className={`paper paper-tight target ${threat ? "target--threat" : ""} ${armed ? "target--armed" : ""}`}
      onClick={onClick}
    >
      {/* Re-keyed by fx.seq so each hit replays the recoil/burst. */}
      <div key={recoiling ? fx!.seq : "base"} className={recoiling ? "recoil" : ""}>
        <div className="display text-base">{label}</div>
        <div className="mono text-[0.65rem] text-paper-fade">{sub}</div>
      </div>
      {fx && fx.kind === "chunk" && <span key={`c${fx.seq}`} className="chunk" />}
      {fx && fx.kind !== "chunk" && <span key={`s${fx.seq}`} className={`spray ${fx.kind === "kill" ? "spray--kill" : ""}`} />}
    </button>
  );
}
