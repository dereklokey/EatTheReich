import { useState } from "react";
import { STATS, type Stat } from "@shared/domain/types.js";
import type { GameState } from "@shared/state/types.js";
import type { CharId } from "@shared/events/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";

/**
 * DECLARE (RULES §4): the player names their *intent* — the stat they're using and
 * which Threats they're engaging. Confirming sends `start_turn`; the theater then opens
 * on the pool builder, where they pick their gear and claim each weapon's bonus inline
 * (no typed narration tags — the condition is shown right on the weapon).
 */
export function DeclareModal({
  seat,
  state,
  onConfirm,
  onCancel,
}: {
  seat: CharId;
  state: GameState;
  onConfirm: (decl: { stat: Stat; engagedThreatIds: string[] }) => void;
  onCancel: () => void;
}) {
  const sheet = CHARACTERS_BY_ID[seat];
  const [stat, setStat] = useState<Stat>("SHOOT");
  const [engaged, setEngaged] = useState<string[]>([]);
  const liveThreats = state.board.threats.filter((t) => t.rating > 0);

  const toggle = (id: string) =>
    setEngaged((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="fixed inset-0 z-[72] grid place-items-center bg-night-deep/90 p-4">
      <div className="paper w-full max-w-lg">
        <h2 className="display text-2xl underline-squiggle inline-block">Declare your action</h2>

        <div className="mt-4">
          <div className="mono text-xs text-paper-fade mb-1">Stat</div>
          <div className="flex flex-wrap gap-1.5">
            {STATS.map((s) => (
              <button
                key={s}
                className={`mono text-sm px-2 py-1 ${stat === s ? "bg-blood text-paper" : "bg-paper-shadow/40"}`}
                style={{ borderRadius: 2 }}
                onClick={() => setStat(s)}
              >
                {s} <span className="opacity-70">{sheet?.stats[s] ?? 2}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="mono text-xs text-paper-fade mb-1">Engaging which Threats?</div>
          {liveThreats.length === 0 ? (
            <p className="mono text-sm text-paper-fade italic">No live Threats — a pure Objective action.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {liveThreats.map((t) => (
                <label key={t.id} className="mono text-sm flex items-center gap-2">
                  <input type="checkbox" checked={engaged.includes(t.id)} onChange={() => toggle(t.id)} />
                  {t.name} <span className="text-blood text-xs">ATK {t.attack}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <p className="mono text-[0.65rem] text-paper-fade mt-4">
          Next: build your pool — pick your weapons and tick each one's bonus when the
          fiction makes it true.
        </p>

        <div className="mt-5 flex gap-2 justify-end">
          <button className="mono text-sm underline text-paper-fade" onClick={onCancel}>
            cancel
          </button>
          <button
            className="display text-paper bg-blood px-4 py-1.5"
            style={{ borderRadius: 2 }}
            onClick={() => onConfirm({ stat, engagedThreatIds: engaged })}
          >
            Begin
          </button>
        </div>
      </div>
    </div>
  );
}
