import { useMemo, useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { CharId, SeatId } from "@shared/events/types.js";
import type { Equipment } from "@shared/domain/character.js";
import { STATS, type Stat } from "@shared/domain/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { buildGmPool, gmPoolContributions } from "@shared/engine/gmPool.js";
import { seatName } from "@/game/seats";
import { buildSuggestedPool, activePowers, itemsToSpend } from "./poolModel";
import "./composer.css";

/** A Blood cost to pay when the action rolls (one per activated ability). */
interface BloodSpend {
  amount: number;
  reason: string;
}

/**
 * The Turn Composer — DECLARE + BUILD_PLAYER_POOL fused into one bench (RULES §4,
 * CLAUDE.md §0, DESIGN.md §6). The active player's private prep surface (the GM can
 * co-drive); the rest of the table sees the board until the dice are cast, then everyone
 * drops into the shared resolution theater.
 *
 * Three zones:
 *   left   — the sheet, rendered for *selection*: pick a stat, toggle weapons/abilities/
 *            the active loot into the pool, tick each printed bonus when the fiction is true.
 *   centre — the assembled pool reads back as a narrated list (each pick + its dice + an ✕
 *            to drop it), the editable total (suggest-don't-enforce), and the ROLL detonator.
 *   right  — the Reich pool the board produces (highest Attack + 1 per other Threat in
 *            play, RULES §4), then a read-only card per live Threat showing the red dice it
 *            contributes. There is no threat *selection*: the player can't pick what to
 *            attack or "avoid," and avoiding never lowers the pool (rulebook p36). The roll
 *            is uncontested only when no Threat is left in play.
 *
 * Rolling fires start_turn → use_equipment → change_blood → roll back-to-back, so the
 * server records the same events a Declare-then-Build flow would and the engine is untouched.
 */
export function TurnComposer({
  seat,
  state,
  send,
  mySeat,
  onCancel,
}: {
  seat: CharId;
  state: GameState;
  send: (i: Intent) => void;
  mySeat: SeatId | null;
  onCancel: () => void;
}) {
  const sheet = CHARACTERS_BY_ID[seat];
  const char = state.characters[seat];
  const canDrive = mySeat === seat || mySeat === "gm";

  // Default the stat to the character's strongest — a suggestion, freely re-clicked.
  const bestStat = useMemo<Stat>(
    () => (sheet ? [...STATS].sort((a, b) => (sheet.stats[b] ?? 0) - (sheet.stats[a] ?? 0))[0]! : "SHOOT"),
    [sheet],
  );
  // Most dangerous first — by Attack descending (ties → closest to death). Purely a
  // reading order; the Reich pool is the same regardless (highest Attack + 1 per other).
  // This also puts the pool's anchor (its full-Attack contributor) at the top.
  const liveThreats = useMemo(
    () => state.board.threats.filter((t) => t.rating > 0).sort((a, b) => b.attack - a.attack || a.rating - b.rating),
    [state.board.threats],
  );
  // The red dice each Threat brings, keyed by id so a card can read off its own contribution.
  const reichByThreat = useMemo(
    () => new Map(gmPoolContributions(state.board.threats).map((c) => [c.threat.id, c])),
    [state.board.threats],
  );

  const [stat, setStat] = useState<Stat>(bestStat);
  const [used, setUsed] = useState<string[]>([]);
  const [powers, setPowers] = useState<string[]>([]);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [override, setOverride] = useState<number | null>(null);
  const [launched, setLaunched] = useState(false);

  // Selectable gear = printed pool weapons + the single active loot item (RULES §11) +
  // any slot-free reward gear (rulebook p39 — doesn't use the active slot, always available).
  const activeLoot = char.loot.find((l) => l.id === char.activeLootSlot && l.loot !== false);
  const gear: Equipment[] = useMemo(
    () => {
      const slotFree = char.loot.filter((l) => l.loot === false);
      return [...(sheet?.equipment ?? []), ...slotFree, ...(activeLoot ? [activeLoot] : [])];
    },
    [sheet, char.loot, activeLoot],
  );
  const poolGear = gear.filter((e) => e.addsDie !== false && (e.uses === undefined || (char.equipmentUses[e.id] ?? 0) > 0));
  // Reactive / economy gear that never adds a pool die (Chuck's hat, Iryna's cigarettes).
  const restGear = (sheet?.equipment ?? []).filter((e) => e.addsDie === false);
  const abilities = activePowers(sheet, char.unlockedAdvances);
  const costOf = (id: string) => abilities.find((p) => p.id === id)?.bloodCost ?? 0;
  const committedBlood = powers.reduce((sum, id) => sum + costOf(id), 0);

  const suggested = useMemo(
    () =>
      buildSuggestedPool({
        statName: stat,
        statRating: sheet?.stats[stat] ?? 2,
        gear,
        abilities,
        usedItemIds: used,
        activatedPowerIds: powers,
        claimedBonusIds: claimed,
        equipmentUses: char.equipmentUses,
      }),
    [stat, sheet, gear, abilities, used, powers, claimed, char.equipmentUses],
  );
  const finalDice = override ?? suggested.total;
  const reichPool = buildGmPool(state.board.threats);

  // Toggling a thing's use resets its bonus claim (a fresh pick starts unclaimed).
  const toggleUse = (id: string) => {
    setUsed((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setClaimed((cur) => cur.filter((x) => x !== id));
  };
  const togglePower = (id: string) => {
    setPowers((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setClaimed((cur) => cur.filter((x) => x !== id));
  };
  const toggleClaim = (id: string) => setClaimed((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const roll = () => {
    if (launched) return;
    setLaunched(true);
    const bloodSpends: BloodSpend[] = powers
      .map((id) => ({ amount: costOf(id), reason: abilities.find((p) => p.id === id)?.name ?? "ability" }))
      .filter((s) => s.amount > 0);

    send({ kind: "start_turn", seat, stat });
    for (const itemId of itemsToSpend(gear, used, char.equipmentUses)) send({ kind: "use_equipment", seat, itemId });
    for (const s of bloodSpends) send({ kind: "change_blood", seat, delta: -s.amount, reason: s.reason });
    send({ kind: "roll", playerPoolDice: finalDice, sources: suggested.sources });
  };

  const cancel = () => {
    if (launched) send({ kind: "cancel_turn" });
    onCancel();
  };

  if (!sheet) return null;

  // The assembled pool, read back as narrated lines. The stat is the base; each piece of
  // gear/ability is a removable line carrying its dice (and its claimable bonus).
  const usedGear = poolGear.filter((e) => used.includes(e.id));
  const usedPowers = abilities.filter((p) => powers.includes(p.id));

  return (
    <div className="composer">
      <div className="composer__bar">
        <h2 className="display text-2xl text-paper flex-1">
          {seatName(seat)} — load the action
        </h2>
        {canDrive && (
          <button className="mono text-xs underline text-paper-fade" onClick={cancel} title="Back out — this won't count as your turn">
            cancel
          </button>
        )}
      </div>

      <div className="composer__grid">
        {/* ───────── LEFT: the sheet, rendered for selection ───────── */}
        <section className="composer__sheet paper">
          <div className="composer__col-head">Your sheet</div>

          <ComposerBlood blood={char.blood} reserved={committedBlood} />

          <div className="composer__group-label">Stat — pick one</div>
          <div className="flex flex-wrap gap-1.5">
            {STATS.map((s) => (
              <button
                key={s}
                disabled={!canDrive}
                className={`composer__stat ${stat === s ? "composer__stat--on" : ""}`}
                onClick={() => setStat(s)}
              >
                {s} <span className="composer__stat-n">{sheet.stats[s]}</span>
              </button>
            ))}
          </div>

          <div className="composer__group-label">Equipment — tap to add (+1 die)</div>
          {poolGear.length === 0 && <p className="mono text-xs text-paper-fade italic">Nothing to bring to bear.</p>}
          {poolGear.map((e) => (
            <PickRow
              key={e.id}
              disabled={!canDrive}
              on={used.includes(e.id)}
              name={e.name}
              plus={1}
              loot={!!activeLoot && e.id === activeLoot.id}
              uses={e.uses !== undefined ? (char.equipmentUses[e.id] ?? 0) : undefined}
              bonus={e.bonus}
              onToggle={() => toggleUse(e.id)}
            />
          ))}

          {abilities.length > 0 && (
            <>
              <div className="composer__group-label">
                Abilities — spend Blood (+1 die)
                {committedBlood > 0 && <span className="text-paper-fade"> · {committedBlood} committed</span>}
              </div>
              {abilities.map((p) => {
                const isOn = powers.includes(p.id);
                const cost = p.bloodCost ?? 0;
                const unaffordable = !isOn && committedBlood + cost > char.blood;
                return (
                  <PickRow
                    key={p.id}
                    disabled={!canDrive || unaffordable}
                    on={isOn}
                    name={p.name}
                    plus={1}
                    cost={cost}
                    text={p.text}
                    bonus={p.bonus}
                    onToggle={() => togglePower(p.id)}
                  />
                );
              })}
            </>
          )}

          {restGear.length > 0 && (
            <>
              <div className="composer__group-label">Used elsewhere</div>
              {restGear.map((e) => (
                <div key={e.id} className="composer__rest mono text-[0.7rem]">
                  {e.name} <span className="text-paper-fade italic">— {e.note ?? "used from your sheet"}</span>
                </div>
              ))}
            </>
          )}
        </section>

        {/* ───────── CENTRE: assembled pool + the detonator ───────── */}
        <section className="composer__pool">
          <div className="composer__col-head">The pool</div>

          <div className="composer__sources">
            <PoolLine label={stat} sub="stat" dice={sheet.stats[stat] ?? 2} base />
            {usedGear.map((e) => (
              <PoolLine
                key={e.id}
                label={e.name}
                sub={!!activeLoot && e.id === activeLoot.id ? "loot" : "weapon"}
                dice={1}
                bonus={e.bonus ? { plus: e.bonus.plus, tag: e.bonus.tag, claimed: claimed.includes(e.id) } : undefined}
                goesOutWithABang={(e.uses ?? 0) > 1 && char.equipmentUses[e.id] === 1}
                onClaim={canDrive && e.bonus ? () => toggleClaim(e.id) : undefined}
                onRemove={canDrive ? () => toggleUse(e.id) : undefined}
              />
            ))}
            {usedPowers.map((p) => (
              <PoolLine
                key={p.id}
                label={p.name}
                sub={`ability · ${p.bloodCost ?? 0} blood`}
                dice={1}
                bonus={p.bonus ? { plus: p.bonus.plus, tag: p.bonus.tag, claimed: claimed.includes(p.id) } : undefined}
                onClaim={canDrive && p.bonus ? () => toggleClaim(p.id) : undefined}
                onRemove={canDrive ? () => togglePower(p.id) : undefined}
              />
            ))}
          </div>

          <div className="composer__total">
            <span className="mono text-xs text-paper-fade">your dice</span>
            {canDrive ? (
              <input
                type="number"
                min={0}
                max={30}
                className="composer__total-in"
                value={finalDice}
                onChange={(e) => setOverride(Number(e.target.value))}
              />
            ) : (
              <b className="display text-4xl text-paper">{finalDice}</b>
            )}
            {override !== null && override !== suggested.total && (
              <button className="mono text-[0.65rem] underline text-paper-fade" onClick={() => setOverride(null)}>
                reset to {suggested.total}
              </button>
            )}
          </div>

          {canDrive && (
            <button className="detonator composer__roll" disabled={launched} onClick={roll}>
              {launched ? "casting…" : "Roll"}
            </button>
          )}
          <p className="mono text-[0.65rem] text-paper-fade text-center mt-2">
            {reichPool > 0
              ? `The Reich answers with ${reichPool} ${reichPool === 1 ? "die" : "dice"}.`
              : "Uncontested — no Threats left standing."}
          </p>
        </section>

        {/* ───────── RIGHT: the Reich pool + the threats that feed it ───────── */}
        <section className="composer__threats">
          <div className="composer__col-head">The Reich</div>

          {/* Total sits ABOVE the cards — the pool the whole board produces. */}
          <div className="composer__reich-banner" title="Highest Attack + 1 per other Threat in play (RULES §4)">
            <span className="composer__reich-n">{reichPool}</span>
            <span className="composer__reich-dice">
              {Array.from({ length: Math.min(reichPool, 12) }, (_, i) => (
                <span key={i} className="minidie minidie--threat" />
              ))}
            </span>
            <span className="mono text-[0.6rem] text-paper-fade">
              {reichPool > 0 ? "dice incoming" : "uncontested"}
            </span>
          </div>

          <div className="composer__threat-list">
            {liveThreats.length === 0 && (
              <p className="mono text-xs text-paper-fade italic">No Threats in play — a clean, unanswered action.</p>
            )}
            {liveThreats.map((t) => {
              const contrib = reichByThreat.get(t.id);
              const dice = contrib?.dice ?? 0;
              return (
                <div key={t.id} className="composer__threat">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="mono font-bold text-paper-ink">{t.name}</span>
                    <span className="mono text-[0.65rem] text-blood">ATK {t.attack}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[0.6rem] text-paper-fade">
                      rating {t.rating}
                      {t.challenge ? ` · challenge ${t.challenge}` : ""}
                    </span>
                    <span className="composer__threat-dice" title={contrib?.anchor ? "full Attack — the most dangerous Threat" : "+1 for another Threat in play"}>
                      {Array.from({ length: Math.min(dice, 8) }, (_, i) => (
                        <span key={i} className="minidie minidie--threat" />
                      ))}
                      <span className="composer__threat-adds">+{dice}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The character's Blood, with cells earmarked for the abilities currently armed: the top
 * `reserved` filled cells flip to a striped hazard pulse so you can see exactly how much
 * Blood this action is about to cost before you commit to the roll (RULES §4).
 */
function ComposerBlood({ blood, reserved }: { blood: number; reserved: number }) {
  return (
    <div className="composer__blood-wrap">
      <div className="composer__group-label" style={{ marginTop: 0 }}>
        Blood {blood}/10
        {reserved > 0 && <span className="composer__blood-note"> · {reserved} reserved for abilities</span>}
      </div>
      <div className="composer__blood">
        {Array.from({ length: 10 }, (_, i) => {
          const filled = i < blood;
          const isReserved = filled && i >= blood - reserved;
          return (
            <span
              key={i}
              className={`composer__blood-cell ${filled ? (isReserved ? "composer__blood-cell--reserved" : "composer__blood-cell--full") : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A selectable line on the sheet (weapon / ability) — tap to fold it into the pool. */
function PickRow({
  on,
  name,
  plus,
  cost,
  uses,
  text,
  bonus,
  loot,
  disabled,
  onToggle,
}: {
  on: boolean;
  name: string;
  plus: number;
  cost?: number;
  uses?: number;
  text?: string;
  bonus?: { tag: string; plus: number };
  loot?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button className={`composer__pick ${on ? "composer__pick--on" : ""}`} disabled={disabled} onClick={onToggle}>
      <div className="flex items-center gap-2">
        <span className="composer__pick-mark">{on ? "✓" : "+"}</span>
        <span className="mono text-sm flex-1 text-left text-paper-ink">
          {name} <span className="text-blood">+{plus}</span>
          {loot && <span className="composer__loot-tag">loot</span>}
        </span>
        {cost !== undefined && cost > 0 && <span className="mono text-[0.65rem] text-paper-fade">{cost} blood</span>}
        {uses !== undefined && <span className="mono text-[0.65rem] text-paper-fade">{uses} left</span>}
      </div>
      {text && <div className="mono text-[0.62rem] text-paper-fade text-left ml-6 mt-0.5">{text}</div>}
      {bonus && <div className="mono text-[0.62rem] text-paper-fade text-left ml-6">bonus: +{bonus.plus} if “{bonus.tag}”</div>}
    </button>
  );
}

/** One narrated line in the assembled pool, carrying its dice as mini-die glyphs. */
function PoolLine({
  label,
  sub,
  dice,
  base,
  bonus,
  goesOutWithABang,
  onClaim,
  onRemove,
}: {
  label: string;
  sub: string;
  dice: number;
  base?: boolean;
  bonus?: { plus: number; tag: string; claimed: boolean };
  goesOutWithABang?: boolean;
  onClaim?: () => void;
  onRemove?: () => void;
}) {
  const bonusDice = bonus?.claimed ? bonus.plus : 0;
  return (
    <div className={`composer__src ${base ? "composer__src--base" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="composer__src-main">
          <span className="composer__src-label">{label}</span>
          <span className="composer__src-sub">{sub}</span>
        </span>
        <span className="composer__dice">
          {Array.from({ length: dice + bonusDice }, (_, i) => (
            <span key={i} className={`minidie ${i >= dice ? "minidie--bonus" : ""}`} />
          ))}
        </span>
        {onRemove ? (
          <button className="composer__x" onClick={onRemove} title="drop from the pool">
            ✕
          </button>
        ) : (
          <span className="composer__x composer__x--locked" title="every action rolls one stat">
            ·
          </span>
        )}
      </div>
      {goesOutWithABang && <div className="composer__bang mono text-[0.6rem]">last use — Go Out With A Bang +1</div>}
      {bonus &&
        (onClaim ? (
          <label className="composer__claim">
            <input type="checkbox" checked={bonus.claimed} onChange={onClaim} />
            <span className={`composer__claim-tag ${bonus.claimed ? "hl" : ""}`}>“{bonus.tag}”</span>
            <span className="composer__claim-plus">+{bonus.plus}</span>
            {!bonus.claimed && <span className="composer__claim-hint">— claim if true</span>}
          </label>
        ) : (
          bonus.claimed && (
            <div className="composer__claim">
              <span className="composer__claim-tag">“{bonus.tag}”</span>
              <span className="composer__claim-plus">+{bonus.plus}</span>
            </div>
          )
        ))}
    </div>
  );
}
