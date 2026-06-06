import { useMemo, useState } from "react";
import type { TurnState, CharacterRuntime } from "@shared/state/types.js";
import type { PoolSource } from "@shared/engine/playerPool.js";
import type { Stat } from "@shared/domain/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { buildSuggestedPool, itemsToSpend } from "./poolModel";

/**
 * BUILD_PLAYER_POOL (RULES §4, DESIGN.md §6). Assemble the pool as a narrated thing:
 * the stat plus each used weapon/ability, every die tagged with its source. The
 * suggested total is the engine's, but the final count is editable — suggest, don't
 * enforce (CLAUDE.md §0). ROLL hands the server the count + sources to roll.
 */
export function PoolBuilder({
  turn,
  char,
  canDrive,
  onRoll,
}: {
  turn: TurnState;
  char: CharacterRuntime;
  canDrive: boolean;
  onRoll: (dice: number, sources: PoolSource[], spendItemIds: string[]) => void;
}) {
  const sheet = CHARACTERS_BY_ID[turn.seat];
  const stat = (turn.stat ?? "SHOOT") as Stat;
  const [used, setUsed] = useState<string[]>([]);
  const [override, setOverride] = useState<number | null>(null);

  const suggested = useMemo(
    () => buildSuggestedPool(sheet, stat, turn.tags, used, char.equipmentUses),
    [sheet, stat, turn.tags, used, char.equipmentUses],
  );
  const finalDice = override ?? suggested.total;

  const toggle = (id: string) =>
    setUsed((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const usableEquipment = (sheet?.equipment ?? []).filter(
    (e) => e.uses === undefined || (char.equipmentUses[e.id] ?? 0) > 0,
  );

  return (
    <div>
      <div className="theater__phase text-sm">Build the pool</div>
      <div className="mono text-paper-fade text-sm mt-1">
        {turn.tags.length > 0 && <>tags: <span className="hl-danger">{turn.tags.join(", ")}</span></>}
      </div>

      {/* Source tags — the assembled, narrated pool (§6). */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {suggested.sources.map((s, i) => (
          <span key={i} className="mono text-xs paper paper-tight">
            {s.label} <b className="text-blood">+{s.dice}</b>
          </span>
        ))}
      </div>

      {canDrive && (
        <div className="mt-4">
          <div className="mono text-xs text-paper-fade mb-1">Use equipment (+1 die each; bonus if its tag is live)</div>
          <div className="flex flex-col gap-1">
            {usableEquipment.map((e) => (
              <label key={e.id} className="mono text-sm flex items-center gap-2 text-paper">
                <input type="checkbox" checked={used.includes(e.id)} onChange={() => toggle(e.id)} />
                {e.name}
                {e.bonus && (
                  <span className={turn.tags.includes(e.bonus.tag) ? "hl text-paper-ink text-xs" : "text-paper-fade text-xs"}>
                    (+{e.bonus.plus} if “{e.bonus.tag}”)
                  </span>
                )}
                {e.uses !== undefined && <span className="text-paper-fade text-xs">[{char.equipmentUses[e.id] ?? 0} left]</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-4">
        <div className="mono text-paper">
          <span className="text-paper-fade text-xs">dice: </span>
          {canDrive ? (
            <input
              type="number"
              min={0}
              max={20}
              className="w-16 bg-paper-shadow/40 text-paper-ink px-2 py-1"
              style={{ borderRadius: 2 }}
              value={finalDice}
              onChange={(e) => setOverride(Number(e.target.value))}
            />
          ) : (
            <b className="text-2xl">{finalDice}</b>
          )}
          {override !== null && override !== suggested.total && (
            <button className="ml-2 text-xs underline text-paper-fade" onClick={() => setOverride(null)}>
              reset to {suggested.total}
            </button>
          )}
        </div>

        {canDrive && (
          <button
            className="detonator ml-auto"
            onClick={() => onRoll(finalDice, suggested.sources, itemsToSpend(sheet, used, char.equipmentUses))}
          >
            Roll
          </button>
        )}
      </div>
    </div>
  );
}
