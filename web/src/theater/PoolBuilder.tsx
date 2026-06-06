import { useMemo, useState } from "react";
import type { TurnState, CharacterRuntime } from "@shared/state/types.js";
import type { PoolSource } from "@shared/engine/playerPool.js";
import type { Stat } from "@shared/domain/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { buildSuggestedPool, itemsToSpend, activePowers } from "./poolModel";

/** A Blood cost to pay when the action rolls (one per activated ability). */
export interface BloodSpend {
  amount: number;
  reason: string;
}

/**
 * BUILD_PLAYER_POOL (RULES §4, DESIGN.md §6). Assemble the pool as a narrated thing:
 * the stat plus each used weapon and each Blood-spent ability, every die tagged with its
 * source. The suggested total is the engine's, but the final count is editable — suggest,
 * don't enforce (CLAUDE.md §0). ROLL hands the server the count + sources to roll.
 *
 * Gear and abilities both fold in *here*, on the turn: tick a weapon (+1 die) or an
 * ability (+1 die, spends its Blood when you Roll), then tick its printed condition to
 * claim the bonus (the condition text is right there, so there's nothing to spell or
 * remember). The GM co-drives this surface, so the bonus checkbox is the award control;
 * nothing commits until the GM-gated Roll.
 */
export function PoolBuilder({
  turn,
  char,
  canDrive,
  isGM,
  onRoll,
}: {
  turn: TurnState;
  char: CharacterRuntime;
  canDrive: boolean;
  isGM: boolean;
  onRoll: (dice: number, sources: PoolSource[], spendItemIds: string[], bloodSpends: BloodSpend[]) => void;
}) {
  const sheet = CHARACTERS_BY_ID[turn.seat];
  const stat = (turn.stat ?? "SHOOT") as Stat;
  const [used, setUsed] = useState<string[]>([]);
  const [powers, setPowers] = useState<string[]>([]);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [override, setOverride] = useState<number | null>(null);

  const suggested = useMemo(
    () => buildSuggestedPool(sheet, stat, used, powers, claimed, char.equipmentUses, char.unlockedAdvances),
    [sheet, stat, used, powers, claimed, char.equipmentUses, char.unlockedAdvances],
  );
  const finalDice = override ?? suggested.total;

  // Toggling an item/power's use always resets its bonus claim: a freshly-used thing
  // starts unclaimed (you then tick the condition), and dropping it drops its claim.
  const toggleUse = (id: string) => {
    setUsed((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setClaimed((cur) => cur.filter((x) => x !== id));
  };
  const togglePower = (id: string) => {
    setPowers((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setClaimed((cur) => cur.filter((x) => x !== id));
  };
  const toggleClaim = (id: string) =>
    setClaimed((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // Pool dice only: weapons you roll. Reactive/economy gear (addsDie === false — the hat
  // used at resolution, cigarettes for Blood) is used from the sheet, not here.
  const usableEquipment = (sheet?.equipment ?? []).filter(
    (e) => e.addsDie !== false && (e.uses === undefined || (char.equipmentUses[e.id] ?? 0) > 0),
  );
  const activeList = activePowers(sheet, char.unlockedAdvances);
  const costOf = (id: string) => activeList.find((p) => p.id === id)?.bloodCost ?? 0;
  const committedBlood = powers.reduce((sum, id) => sum + costOf(id), 0);

  const roll = () => {
    const bloodSpends: BloodSpend[] = powers
      .map((id) => ({ amount: costOf(id), reason: activeList.find((p) => p.id === id)?.name ?? "ability" }))
      .filter((s) => s.amount > 0);
    onRoll(finalDice, suggested.sources, itemsToSpend(sheet, used, char.equipmentUses), bloodSpends);
  };

  return (
    <div>
      <div className="theater__phase text-sm">Build the pool</div>

      {/* Source tags — the assembled, narrated pool, updates live as gear/abilities toggle (§6). */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {suggested.sources.map((s, i) => (
          <span key={i} className="mono text-xs paper paper-tight">
            {s.label} <b className="text-blood">+{s.dice}</b>
          </span>
        ))}
      </div>

      {canDrive && (
        <div className="mt-4">
          <div className="mono text-xs text-paper-fade mb-1">Assemble your gear — each item adds +1 die</div>
          <div className="flex flex-col gap-1.5">
            {usableEquipment.map((e) => {
              const isUsed = used.includes(e.id);
              const isClaimed = claimed.includes(e.id);
              return (
                <div key={e.id} className="paper paper-tight">
                  <label className="mono text-sm flex items-center gap-2 text-paper-ink cursor-pointer">
                    <input type="checkbox" checked={isUsed} onChange={() => toggleUse(e.id)} />
                    <span className="flex-1">
                      {e.name} <span className="text-blood">+1</span>
                    </span>
                    {e.uses !== undefined && (
                      <span className="text-paper-fade text-xs">{char.equipmentUses[e.id] ?? 0} left</span>
                    )}
                  </label>

                  {e.bonus &&
                    (isUsed ? (
                      <BonusClaim tag={e.bonus.tag} plus={e.bonus.plus} claimed={isClaimed} onToggle={() => toggleClaim(e.id)} />
                    ) : (
                      <BonusHint tag={e.bonus.tag} plus={e.bonus.plus} />
                    ))}
                </div>
              );
            })}
          </div>

          {activeList.length > 0 && (
            <>
              <div className="mono text-xs text-paper-fade mb-1 mt-4">
                Spend Blood on an ability — adds +1 die{" "}
                <span className="text-paper-fade/70">({char.blood} Blood{committedBlood > 0 ? `, ${committedBlood} committed` : ""})</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {activeList.map((p) => {
                  const isOn = powers.includes(p.id);
                  const isClaimed = claimed.includes(p.id);
                  const cost = p.bloodCost ?? 0;
                  const unaffordable = !isOn && committedBlood + cost > char.blood;
                  return (
                    <div key={p.id} className={`paper paper-tight ${unaffordable ? "opacity-50" : ""}`}>
                      <label className={`mono text-sm flex items-center gap-2 text-paper-ink ${unaffordable ? "cursor-not-allowed" : "cursor-pointer"}`}>
                        <input type="checkbox" checked={isOn} disabled={unaffordable} onChange={() => togglePower(p.id)} />
                        <span className="flex-1">
                          {p.name} <span className="text-blood">+1</span>
                        </span>
                        <span className="text-paper-fade text-xs">{cost} Blood</span>
                      </label>
                      <div className="mono text-[0.65rem] text-paper-fade ml-6">{p.text}</div>
                      {p.bonus &&
                        (isOn ? (
                          <BonusClaim tag={p.bonus.tag} plus={p.bonus.plus} claimed={isClaimed} onToggle={() => toggleClaim(p.id)} />
                        ) : (
                          <BonusHint tag={p.bonus.tag} plus={p.bonus.plus} />
                        ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <p className="mono text-[0.65rem] text-paper-fade mt-2">
            {isGM
              ? "Tick a bonus to grant it — you decide when the fiction earns the extra dice."
              : "Tick a bonus when the fiction is true; the GM confirms it before you roll."}
          </p>
          <p className="mono text-[0.6rem] text-paper-fade/70 mt-1">
            Passives, effect-only abilities, and reactive items (e.g. the hat at resolution) live on your sheet.
          </p>
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
          <button className="detonator ml-auto" onClick={roll}>
            Roll
          </button>
        )}
      </div>
    </div>
  );
}

/** A claimable bonus condition shown inline on an in-use item/ability. */
function BonusClaim({ tag, plus, claimed, onToggle }: { tag: string; plus: number; claimed: boolean; onToggle: () => void }) {
  return (
    <label className="mono text-xs flex items-center gap-2 mt-1.5 ml-6 cursor-pointer">
      <input type="checkbox" checked={claimed} onChange={onToggle} />
      <span className={claimed ? "hl text-paper-ink" : "text-paper-fade"}>“{tag}”</span>
      <span className="text-blood">+{plus}</span>
      {!claimed && <span className="text-paper-fade italic">— claim if true</span>}
    </label>
  );
}

/** The same bonus condition, faded, shown on an item/ability that isn't in use yet. */
function BonusHint({ tag, plus }: { tag: string; plus: number }) {
  return (
    <div className="mono text-[0.65rem] text-paper-fade mt-1 ml-6 italic">
      bonus if “{tag}” is true: +{plus}
    </div>
  );
}
