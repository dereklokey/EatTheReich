import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GameState, TurnState, CharacterRuntime } from "@shared/state/types.js";
import type { PlayerDie } from "@shared/engine/dice.js";
import type { Allocation } from "@shared/engine/allocate.js";
import { applyOneAllocation, emptyAccumulator } from "@shared/engine/allocate.js";
import { feedBlockedByBloodless } from "@shared/domain/types.js";
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

  // Live preview via the real engine (challenge soak, rating clamp, GM-die removal). A
  // 'Painless' raise (#19) is threaded in as challengeBump so the soak preview matches the server.
  const challengeBump = turn.challengeBump;
  const preview = useMemo(() => {
    const start = emptyAccumulator({ objectives: state.board.objectives, threats: state.board.threats }, gmRemaining, challengeBump);
    return assign.filter((a): a is Allocation => a !== null).reduce(applyOneAllocation, start);
  }, [assign, state.board.objectives, state.board.threats, gmRemaining, challengeBump]);

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
        const effChallenge = (thr.challenge ?? 0) + (challengeBump?.[thr.id] ?? 0);
        const challengeLeft = Math.max(0, effChallenge - (preview.challengeConsumed[thr.id] ?? 0));
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

  // The dice that have landed on a given target — they live ON the card now (issue #11),
  // tap to take one back. Pairs the die with its survivor index so unassign can free it.
  const placedOn = (match: (a: Allocation) => boolean): { die: PlayerDie; i: number }[] =>
    assign.flatMap((a, i) => (a && match(a) ? [{ die: survivors[i]!, i }] : []));

  const allocations = assign.filter((a): a is Allocation => a !== null);
  const unplaced = assign.filter((a) => a === null).length;
  const allPlaced = survivors.length > 0 && unplaced === 0;
  const pickedDie = picked !== null ? survivors[picked] : undefined;
  // A SPECIAL is critical-only (RULES §4): a crit arms the special cards, any other
  // pick can't land there — the card greys to say so.
  const critPicked = pickedDie?.kind === "crit";

  const objLive = preview.board.objectives;
  // Staged threats (issue #12) aren't in the fight, so they're not allocatable targets.
  const thrLive = preview.board.threats.filter((t) => t.active !== false);
  // Einherjar 'Bloodless' (#20): no Feed while it's the only Threat in play. Computed off the
  // live board (the same shared predicate the engine uses) — greys the Feed target with the reason.
  const feedBlocked = feedBlockedByBloodless(state.board.threats);

  return (
    <div>
      <div className="theater__phase text-sm">Allocate your dice</div>

      {/* Surviving dice — tap one to pick it up, then tap a target. Placed dice leave the
          tray and land on the card they were distributed to (issue #11). */}
      <div className="tray mt-3">
        {survivors.map((die, i) =>
          assign[i] ? null : (
            <button
              key={i}
              className={`die-pick ${picked === i ? "die-pick--selected" : ""}`}
              disabled={!canDrive}
              onClick={() => setPicked(i)}
              title="tap to pick up"
            >
              <Die kind="player" value={die.face} state={die.kind === "crit" ? "critical" : "success"} tilt={tiltFor(i)} entering={enterFrom !== null && i >= enterFrom} />
            </button>
          ),
        )}
        {survivors.length === 0 && <span className="mono text-paper-fade italic">No survivors — all dice discarded.</span>}
        {allPlaced && <span className="mono text-paper-fade italic text-xs">All dice placed — tap a die on a card to take it back.</span>}
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
            placed={placedOn((a) => a.kind === "advance" && a.targetId === o.id)}
            onUnplace={unassign}
          />
        ))}
        {thrLive.map((t) => {
          // 'Painless' (#19) raises the effective Challenge for this action — show the inflated
          // soak (with a marker) so the player isn't surprised when dice vanish into it.
          const bump = challengeBump?.[t.id] ?? 0;
          const effChallenge = (t.challenge ?? 0) + bump;
          return (
            <TargetCard
              key={t.id}
              threat
              fx={cardFx[t.id]}
              armed={picked !== null}
              label={t.name}
              sub={
                <>
                  {`Threat · rating ${t.rating} · ATK ${t.attack}`}
                  {effChallenge ? ` · challenge ${effChallenge}` : ""}
                  {bump ? <span className="text-blood font-bold"> ⚠ Painless</span> : null}
                </>
              }
              onClick={() => place({ kind: "eliminate", targetId: t.id })}
              placed={placedOn((a) => a.kind === "eliminate" && a.targetId === t.id)}
              onUnplace={unassign}
            />
          );
        })}
        <TargetCard
          armed={picked !== null}
          label="Defend"
          sub={`Knock off GM Attack dice · ${preview.gmDiceRemaining} incoming`}
          onClick={() => place({ kind: "defend" })}
          placed={placedOn((a) => a.kind === "defend")}
          onUnplace={unassign}
        />
        <TargetCard
          armed={picked !== null && !feedBlocked}
          blocked={feedBlocked}
          label="Feed"
          sub={
            feedBlocked ? (
              <span className="text-blood font-bold">⚠ Bloodless — no Feed (engaged only with the Einherjar)</span>
            ) : (
              `Drink deep · +${preview.bloodGained} Blood (now ${Math.min(10, char.blood + preview.bloodGained)})`
            )
          }
          hint={feedBlocked ? "Einherjar 'Bloodless' (rulebook p55): can't spend dice to regain Blood while it's the only Threat in play." : undefined}
          onClick={() => !feedBlocked && place({ kind: "feed" })}
          placed={placedOn((a) => a.kind === "feed")}
          onUnplace={unassign}
        />
        {/* SPECIALs sit in the list like any other target so the table sees them, but only
            a critical can arm one (RULES §4). A non-crit pick greys them with the reason. */}
        {specials.map((sp) => (
          <TargetCard
            key={sp.id}
            special
            armed={critPicked}
            blocked={picked !== null && !critPicked}
            label={sp.name}
            sub={`SPECIAL · critical only${sp.grantsBlood ? ` · +${sp.grantsBlood} Blood` : ""}`}
            hint={sp.text}
            onClick={() => critPicked && place({ kind: "special", specialId: sp.id })}
            placed={placedOn((a) => a.kind === "special" && a.specialId === sp.id)}
            onUnplace={unassign}
          />
        ))}
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
  special,
  blocked,
  hint,
  fx,
  placed,
  onUnplace,
}: {
  label: string;
  sub: ReactNode;
  onClick: () => void;
  armed: boolean;
  threat?: boolean;
  special?: boolean;
  /** A die is picked but can't land here (a non-crit aimed at a SPECIAL). */
  blocked?: boolean;
  /** Tooltip for the card itself (the SPECIAL's rules text). */
  hint?: string;
  fx?: CardFx;
  placed: { die: PlayerDie; i: number }[];
  onUnplace: (i: number) => void;
}) {
  const recoiling = fx && fx.kind !== "chunk";
  return (
    <button
      className={`paper paper-tight target ${threat ? "target--threat" : ""} ${special ? "target--special" : ""} ${armed ? "target--armed" : ""} ${blocked ? "target--blocked" : ""}`}
      onClick={onClick}
      title={hint}
    >
      {/* Re-keyed by fx.seq so each hit replays the recoil/burst. */}
      <div key={recoiling ? fx!.seq : "base"} className={recoiling ? "recoil" : ""}>
        <div className="display text-base">{label}</div>
        <div className="mono text-[0.65rem] text-paper-fade">{sub}</div>
      </div>
      {/* Dice distributed here (issue #11) — tap one to take it back to the tray. Spans
          (not buttons) avoid nesting interactive elements; stopPropagation keeps the tap
          from re-placing the picked die on this card. */}
      {placed.length > 0 && (
        <div className="target__dice">
          {placed.map(({ die, i }) => (
            <span
              key={i}
              role="button"
              tabIndex={0}
              className="placed-die"
              title="tap to take this die back"
              onClick={(e) => {
                e.stopPropagation();
                onUnplace(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onUnplace(i);
                }
              }}
            >
              <Die kind="player" value={die.face} state={die.kind === "crit" ? "critical" : "success"} size="1.7rem" tilt={tiltFor(i)} />
            </span>
          ))}
        </div>
      )}
      {fx && fx.kind === "chunk" && <span key={`c${fx.seq}`} className="chunk" />}
      {fx && fx.kind !== "chunk" && <span key={`s${fx.seq}`} className={`spray ${fx.kind === "kill" ? "spray--kill" : ""}`} />}
    </button>
  );
}
