import { useMemo, useState } from "react";
import type { GameState, TurnState, CharacterRuntime } from "@shared/state/types.js";
import type { Allocation } from "@shared/engine/allocate.js";
import { applyOneAllocation, emptyAccumulator } from "@shared/engine/allocate.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { Die, tiltFor } from "@/components/dice/Die";

/**
 * ALLOCATE (RULES §4, DESIGN.md §6). Each surviving die is placed on a target —
 * Advance an Objective, Eliminate a Threat, Defend (knock off GM Attack dice), Feed
 * (+Blood), or activate a SPECIAL (criticals only). Tap a die, then tap a target
 * (drag's tap fallback). A live local preview folds the same engine the server uses,
 * so the numbers match before "Lock in" commits and runs the injury check.
 */
type Assignment = Allocation | null;

export function AllocationTray({
  turn,
  state,
  char,
  canDrive,
  onLockIn,
}: {
  turn: TurnState;
  state: GameState;
  char: CharacterRuntime;
  canDrive: boolean;
  onLockIn: (allocations: Allocation[]) => void;
}) {
  const survivors = turn.survivors ?? [];
  const gmRemaining = turn.gmDiceRemaining ?? 0;
  const [assign, setAssign] = useState<Assignment[]>(() => survivors.map(() => null));
  const [picked, setPicked] = useState<number | null>(null);

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

  const place = (alloc: Omit<Allocation, "units">) => {
    if (picked === null) return;
    const die = survivors[picked];
    if (!die) return;
    setAssign((cur) => cur.map((a, i) => (i === picked ? { ...alloc, units: die.units } : a)));
    setPicked(null);
  };

  const unassign = (i: number) => setAssign((cur) => cur.map((a, idx) => (idx === i ? null : a)));

  const allocations = assign.filter((a): a is Allocation => a !== null);
  const unplaced = assign.filter((a) => a === null).length;
  const pickedDie = picked !== null ? survivors[picked] : undefined;

  const objLive = preview.board.objectives;
  const thrLive = preview.board.threats;

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
              <Die kind="player" value={die.face} state={die.kind === "crit" ? "critical" : "success"} tilt={tiltFor(i)} />
            </button>
          );
        })}
        {survivors.length === 0 && <span className="mono text-paper-fade italic">No survivors — all dice discarded.</span>}
      </div>

      <p className="mono text-xs text-paper-fade mt-1">
        {pickedDie
          ? `Placing a ${pickedDie.kind} (${pickedDie.units} unit${pickedDie.units > 1 ? "s" : ""}) — tap a target`
          : canDrive
            ? "Tap a die to pick it up."
            : "Watching the active player allocate."}
      </p>

      {/* Targets */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {objLive.map((o) => (
          <TargetCard
            key={o.id}
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
    </div>
  );
}

function TargetCard({
  label,
  sub,
  onClick,
  armed,
  threat,
}: {
  label: string;
  sub: string;
  onClick: () => void;
  armed: boolean;
  threat?: boolean;
}) {
  return (
    <button
      className={`paper paper-tight target ${threat ? "target--threat" : ""} ${armed ? "target--armed" : ""}`}
      onClick={onClick}
    >
      <div className="display text-base">{label}</div>
      <div className="mono text-[0.65rem] text-paper-fade">{sub}</div>
    </button>
  );
}
