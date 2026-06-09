import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { CharId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { STATS, threatInPlay, isChallengeUnlowerable } from "@shared/domain/types.js";
import type { BoardSnapshot, CharacterRuntime } from "@shared/state/types.js";
import type { Power } from "@shared/domain/character.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { activeMantle, effectiveStats, itemsBlockedByMantle } from "@shared/state/stances.js";
import { useEffects } from "@/effects/EffectsContext";
import { seatName } from "@/game/seats";
import "./sheet.css";

/**
 * Character sheet (CLAUDE.md §4). The owner (and the GM) get the controls; everyone
 * else sees it read-only. Healing costs 3 Blood (RULES §5), so a heal both clears the
 * box and spends the Blood. All edits are server intents — the sheet never mutates
 * state directly.
 */
const HEAL_COST = 3;

export function CharacterSheet({
  seat,
  state,
  send,
  canEdit,
  onClose,
}: {
  seat: CharId;
  state: GameState;
  send: (i: Intent) => void;
  canEdit: boolean;
  onClose: () => void;
}) {
  const sheet = CHARACTERS_BY_ID[seat];
  const char = state.characters[seat];
  const { reduced } = useEffects();

  // The cost & care (§6): diff this render against the last to fire one-shots when an
  // injury is marked/healed or the character goes Downed/Dead. `seq` re-keys the
  // animating element so each transition replays; refs avoid firing on first open/resume.
  const prevRef = useRef<{ inj: readonly number[]; downed: boolean; dead: boolean } | null>(null);
  const [injFx, setInjFx] = useState<{ cat: number; kind: "mark" | "heal"; seq: number } | null>(null);
  const [stampSlam, setStampSlam] = useState(0);
  const [shuddering, setShuddering] = useState(false);
  const fxSeq = useRef(0);

  const injuries = char?.injuries;
  const downed = char?.downed;
  const dead = char?.dead;
  useEffect(() => {
    const cur = { inj: injuries ?? [], downed: !!downed, dead: !!dead };
    const p = prevRef.current;
    prevRef.current = cur;
    if (!p || reduced) return;
    for (let cat = 0; cat < cur.inj.length; cat++) {
      const before = p.inj[cat] ?? 0;
      if (cur.inj[cat]! > before) {
        setInjFx({ cat, kind: "mark", seq: ++fxSeq.current });
        if (cur.inj[cat]! >= 2) setShuddering(true); // penalty box → whole-sheet shudder
      } else if (cur.inj[cat]! < before) {
        setInjFx({ cat, kind: "heal", seq: ++fxSeq.current });
      }
    }
    if ((cur.downed && !p.downed) || (cur.dead && !p.dead)) setStampSlam(++fxSeq.current);
  }, [injuries, downed, dead, reduced]);

  useEffect(() => {
    if (!shuddering) return;
    const t = setTimeout(() => setShuddering(false), 460);
    return () => clearTimeout(t);
  }, [shuddering]);

  if (!sheet) return null;

  // Mantle of the Fell Beast (#36): a persistent stance that reshapes stats + locks items until its
  // bound Objective is done. Read derived (activeMantle) so completing the Objective by any path ends it.
  const mantle = activeMantle(char, state.board.objectives);
  const stats = effectiveStats(sheet.stats, mantle);
  const itemsLocked = itemsBlockedByMantle(char, state.board.objectives);

  return (
    <div className="fixed inset-0 z-[66] flex justify-end">
      <button className="flex-1 bg-night-deep/70" aria-label="close" onClick={onClose} />
      <div
        className={`w-full max-w-md h-full overflow-y-auto bg-paper text-paper-ink p-4 pb-24 ${char.dead ? "sheet--dead" : char.downed ? "sheet--downed" : ""} ${shuddering ? "sheet-shudder" : ""}`}
        style={{ boxShadow: "-12px 0 30px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="display text-3xl underline-squiggle inline-block">{sheet.name}</h2>
            <p className="mono text-xs text-paper-fade mt-1">{sheet.blurb}</p>
          </div>
          <button className="mono text-sm underline text-paper-fade" onClick={onClose}>close</button>
        </div>
        {(char.downed || char.dead) && (
          <div key={`stamp-${stampSlam}`} className={`stamp mt-2 ${stampSlam && !reduced ? "stamp--slam" : ""}`}>
            {char.dead ? "DEAD" : "DOWNED"}
          </div>
        )}

        <BloodSection seat={seat} char={char} canEdit={canEdit} state={state} send={send} />

        <Section title="Stats">
          {mantle && (
            <div className="mono text-[0.62rem] text-blood mb-1.5" title={mantle.powerName}>
              ⚝ {mantle.powerName} — BRAWL/TERRIFY {mantle.highValue}, all else {mantle.lowValue}, items locked (until {mantle.objectiveName ?? "the Objective"} is done)
            </div>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            {STATS.map((s) => {
              const changed = mantle && stats[s] !== sheet.stats[s];
              return (
                <div key={s} className={`text-center border py-1 ${changed ? "border-blood" : "border-paper-shadow"}`}>
                  <div className="mono text-[0.6rem] text-paper-fade">{s}</div>
                  <div className={`display text-xl ${changed ? "text-blood" : ""}`}>{stats[s]}</div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Equipment">
          {itemsLocked && (
            <div className="mono text-[0.62rem] text-blood italic mb-1.5">Items locked by {mantle?.powerName}.</div>
          )}
          {sheet.equipment.map((e) => {
            const tracked = e.uses !== undefined;
            const remaining = char.equipmentUses[e.id] ?? e.uses ?? 0;
            const rusted = (char.degradedEquipment ?? []).includes(e.id);
            return (
              <div key={e.id} className="mb-2 border-b border-paper-shadow/40 pb-2">
                <div className="flex items-center gap-2">
                  <span className={`mono text-sm flex-1 ${rusted ? "rusted-name" : ""}`}>{e.name}</span>
                  {rusted && <span className="stamp stamp--rust text-[0.55rem]" title="Rusted by the Rust-Witch — useless until the GM repairs it">rusted</span>}
                  {tracked && (
                    <UseBoxes
                      total={e.uses ?? 0}
                      remaining={remaining}
                      canEdit={canEdit && !itemsLocked}
                      onSpend={() => send({ kind: "use_equipment", seat, itemId: e.id })}
                      onRestore={() => send({ kind: "restore_equipment", seat, itemId: e.id })}
                    />
                  )}
                </div>
                {e.bonus && <div className="mono text-[0.65rem] text-paper-fade">+{e.bonus.plus} when “{e.bonus.tag}”</div>}
                {e.note && <div className="mono text-[0.65rem] text-paper-fade italic">{e.note}</div>}
              </div>
            );
          })}
        </Section>

        <PowerSection title="Abilities" powers={sheet.abilities} seat={seat} char={char} canEdit={canEdit} send={send} board={state.board} />
        <PowerSection title="Advances" powers={sheet.advances} seat={seat} char={char} canEdit={canEdit} send={send} board={state.board} advances />

        <Section title="Injuries">
          {sheet.injuries.map((cat, ci) => {
            const marked = char.injuries[ci] ?? 0;
            const category = ci as 0 | 1 | 2;
            return (
              <div key={ci} className="mb-2">
                <div className="flex items-center gap-2">
                  <span className="mono text-[0.6rem] text-paper-fade w-7 shrink-0" title={`rolled ${cat.faces[0]}–${cat.faces[1]}`}>
                    {cat.faces[0]}–{cat.faces[1]}
                  </span>
                  {/* Label + heal sit together on the left; heal trails the text rather than
                      the boxes so the box cluster stays aligned across rows (issue #3). */}
                  <span className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="mono text-sm">{cat.boxes[0]?.label}</span>
                    {canEdit && marked > 0 && (
                      <button
                        className="mono text-xs underline text-blood disabled:opacity-40"
                        disabled={char.blood < HEAL_COST}
                        title={`Spend ${HEAL_COST} Blood to clear a box`}
                        onClick={() => {
                          send({ kind: "change_blood", seat, delta: -HEAL_COST, reason: "heal" });
                          send({ kind: "heal", seat, category, box: marked as 1 | 2 });
                        }}
                      >
                        heal ({HEAL_COST})
                      </button>
                    )}
                  </span>
                  <span className="flex gap-0.5 shrink-0">
                    {cat.boxes.map((box, bi) => {
                      const isMarked = marked >= bi + 1;
                      const justMarked = !reduced && injFx?.kind === "mark" && injFx.cat === ci && bi + 1 === marked;
                      const justHealed = !reduced && injFx?.kind === "heal" && injFx.cat === ci && bi + 1 === marked + 1;
                      // Manual override (no Blood): click the next empty box to mark an injury,
                      // or the last ✕ box to clear it — for undoing mistakes. The heal (3) button
                      // stays the in-fiction, Blood-spending heal; Blood is fixed on the meter.
                      const boxNo = (bi + 1) as 1 | 2;
                      const isNextEmpty = bi === marked;
                      const isLastMarked = bi === marked - 1;
                      const interactive = canEdit && (isNextEmpty || isLastMarked);
                      const act = isNextEmpty
                        ? () => send({ kind: "mark_injury", seat, category, box: boxNo })
                        : () => send({ kind: "heal", seat, category, box: boxNo });
                      return (
                        <span
                          key={bi}
                          role={interactive ? "button" : undefined}
                          tabIndex={interactive ? 0 : undefined}
                          aria-label={interactive ? (isNextEmpty ? "mark this injury (no Blood)" : "clear this injury (no Blood)") : undefined}
                          onClick={interactive ? act : undefined}
                          onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } } : undefined}
                          className={`injury-box grid place-items-center w-5 h-5 border border-paper-shadow text-blood ${interactive ? "injury-box--live" : ""}`}
                          title={box.penalty ?? box.label}
                        >
                          {isMarked && (
                            <span key={justMarked ? `m${injFx!.seq}` : "m"} className={justMarked ? "ink-splat" : undefined}>✕</span>
                          )}
                          {justHealed && <span key={`h${injFx!.seq}`} className="heal-shimmer" />}
                        </span>
                      );
                    })}
                  </span>
                </div>
                {/* The 2nd box's effect is always on the sheet now (issue #3): dim as a heads-up
                    while unmarked, blood-red once that box is actually taken. */}
                {cat.boxes[1]?.penalty && (
                  <div className={`mono text-[0.62rem] ml-9 ${marked >= 2 ? "text-blood" : "text-paper-fade italic"}`}>
                    {marked >= 2 ? cat.boxes[1].penalty : `2nd box — ${cat.boxes[1].penalty}`}
                  </div>
                )}
              </div>
            );
          })}
        </Section>

        <Section title="Loot">
          {char.loot.length === 0 ? (
            <p className="mono text-xs text-paper-fade italic">No loot yet. One active slot at a time (RULES §11).</p>
          ) : (
            char.loot.map((item) => {
              const slotFree = item.loot === false; // secondary-objective reward gear (rulebook p39)
              const active = char.activeLootSlot === item.id;
              const tracked = item.uses !== undefined;
              const remaining = char.equipmentUses[item.id] ?? item.uses ?? 0;
              const rusted = (char.degradedEquipment ?? []).includes(item.id);
              return (
                <div key={item.id} className="mb-2 border-b border-paper-shadow/40 pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`mono text-sm flex-1 ${rusted ? "rusted-name" : ""}`}>{item.name}</span>
                    {rusted && <span className="stamp stamp--rust text-[0.55rem]" title="Rusted by the Rust-Witch — useless until the GM repairs it">rusted</span>}
                    {tracked && (
                      <UseBoxes
                        total={item.uses ?? 0}
                        remaining={remaining}
                        canEdit={canEdit && !itemsLocked}
                        onSpend={() => send({ kind: "use_equipment", seat, itemId: item.id })}
                        onRestore={() => send({ kind: "restore_equipment", seat, itemId: item.id })}
                      />
                    )}
                    {/* Slot-free gear is always in play (no active-slot juggling); regular loot
                        keeps the one-active-at-a-time activate control (RULES §11). */}
                    {slotFree ? (
                      <span className="stamp text-[0.6rem]" title="Doesn’t occupy a Loot slot — always ready">ready · no slot</span>
                    ) : active ? (
                      <span className="stamp text-[0.6rem]">active</span>
                    ) : (
                      canEdit && (
                        <button className="mono text-xs underline text-blood" onClick={() => send({ kind: "loot_activate", seat, itemId: item.id })}>
                          activate
                        </button>
                      )
                    )}
                  </div>
                  {item.bonus && <div className="mono text-[0.65rem] text-paper-fade">+{item.bonus.plus} when “{item.bonus.tag}”</div>}
                  {item.note && <div className="mono text-[0.65rem] text-paper-fade italic">{item.note}</div>}
                </div>
              );
            })
          )}
        </Section>

        <Section title="Flashback">
          {/* Status only (issue #9): the flashback is *used* from the roll-results screen
              when a roll comes up weak, not triggered here. This just reports whether it's
              still in hand this session. */}
          {!state.session.active ? (
            <p className="mono text-xs text-paper-fade italic">Available once the session has started.</p>
          ) : char.flashbackUsedThisSession ? (
            <p className="mono text-xs text-paper-fade italic">Spent this session.</p>
          ) : (
            <p className="mono text-xs text-dusk-mauve">
              Ready this session — cut to it from a weak roll (≤2 successes) to reroll with +2 dice.
            </p>
          )}
        </Section>

        <Section title="Last stand">
          <p className="mono text-xs text-paper-fade italic">{sheet.lastStand}</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="display text-lg mb-2">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Equipment / loot use track, drawn like the injury boxes (issue #3): each box is empty
 * until the use is spent, then it takes a blood ✕ — so a fresh item reads as all-empty,
 * not all-full. Click to edit, but only at the boundary (RULES §0 "suggest, don't
 * enforce"): the next empty box spends a use, the last ✕ box hands one back. Everything
 * in between is inert, so a stray tap can't blank or max the track.
 */
function UseBoxes({
  total,
  remaining,
  canEdit,
  onSpend,
  onRestore,
}: {
  total: number;
  remaining: number;
  canEdit: boolean;
  onSpend: () => void;
  onRestore: () => void;
}) {
  const spent = Math.min(total, Math.max(0, total - remaining));
  return (
    <span className="inline-flex gap-0.5" title={`${remaining}/${total} uses`}>
      {Array.from({ length: total }, (_, i) => {
        const isSpent = i < spent;
        const isNextEmpty = i === spent; // leftmost available → spend it
        const isLastSpent = i === spent - 1; // rightmost ✕ → give it back
        const interactive = canEdit && (isNextEmpty || isLastSpent);
        const act = isNextEmpty ? onSpend : onRestore;
        return (
          <span
            key={i}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={isNextEmpty ? "spend a use" : isLastSpent ? "give a use back" : undefined}
            title={isNextEmpty ? "spend a use" : isLastSpent ? "give a use back" : undefined}
            onClick={interactive ? act : undefined}
            onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } } : undefined}
            className={`use-box grid place-items-center w-5 h-5 border border-paper-shadow text-blood ${interactive ? "use-box--live" : ""}`}
          >
            {isSpent && <span>✕</span>}
          </span>
        );
      })}
    </span>
  );
}

function BloodSection({
  seat,
  char,
  canEdit,
  state,
  send,
}: {
  seat: CharId;
  char: GameState["characters"][CharId];
  canEdit: boolean;
  state: GameState;
  send: (i: Intent) => void;
}) {
  const { reduced } = useEffects();
  const [to, setTo] = useState<CharId | "">("");
  const [amount, setAmount] = useState(1);
  const mates = CHAR_IDS.filter((id) => id !== seat && state.seats[id]?.claimed && !state.characters[id]?.dead);

  // Flood up on a gain (feed/share), bleed down on a spend (heal/ability) — §6.
  const prevBlood = useRef(char.blood);
  const [pulse, setPulse] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (prevBlood.current !== char.blood && !reduced) {
      setPulse(char.blood > prevBlood.current ? "up" : "down");
    }
    prevBlood.current = char.blood;
  }, [char.blood, reduced]);
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 620);
    return () => clearTimeout(t);
  }, [pulse]);

  return (
    <Section title={`Blood — ${char.blood}/10`}>
      <div className={`flex gap-0.5 ${pulse === "up" ? "blood-meter--up" : pulse === "down" ? "blood-meter--down" : ""}`} style={{ borderRadius: 1 }}>
        {Array.from({ length: 10 }, (_, i) => {
          // Click the meter to drink/spend, but only at the waterline (issue #3): the next
          // empty cell adds a Blood, the last full one drains it. No filling gaps mid-track.
          const isNextEmpty = i === char.blood;
          const isLastFull = i === char.blood - 1;
          const interactive = canEdit && (isNextEmpty || isLastFull);
          return (
            <span
              key={i}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={isNextEmpty ? "add a Blood" : isLastFull ? "spend a Blood" : undefined}
              title={isNextEmpty ? "add a Blood" : isLastFull ? "spend a Blood" : undefined}
              onClick={interactive ? () => send({ kind: "change_blood", seat, delta: isNextEmpty ? 1 : -1 }) : undefined}
              onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); send({ kind: "change_blood", seat, delta: isNextEmpty ? 1 : -1 }); } } : undefined}
              className={`blood-cell h-3 flex-1 ${interactive ? "blood-cell--live" : ""}`}
              style={{ backgroundColor: i < char.blood ? "var(--blood)" : "var(--paper-shadow)", borderRadius: 1 }}
            />
          );
        })}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="mono text-xs px-2 bg-paper-shadow/50" onClick={() => send({ kind: "change_blood", seat, delta: -1 })}>−1</button>
          <button className="mono text-xs px-2 bg-paper-shadow/50" onClick={() => send({ kind: "change_blood", seat, delta: 1 })}>+1</button>
          {mates.length > 0 && (
            <span className="flex items-center gap-1 ml-auto">
              <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={to} onChange={(e) => setTo(e.target.value as CharId)}>
                <option value="">share to…</option>
                {mates.map((id) => <option key={id} value={id}>{seatName(id)}</option>)}
              </select>
              <input type="number" min={1} max={char.blood} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-12 mono text-xs px-1 py-0.5 bg-paper-shadow/40" />
              <button
                className="mono text-xs underline text-blood disabled:opacity-40"
                disabled={!to || amount < 1 || amount > char.blood}
                onClick={() => { if (to) send({ kind: "share_blood", from: seat, to, amount }); }}
              >
                give
              </button>
            </span>
          )}
        </div>
      )}
    </Section>
  );
}

function PowerSection({
  title,
  powers,
  seat,
  char,
  canEdit,
  send,
  board,
  advances,
}: {
  title: string;
  powers: Power[];
  seat: CharId;
  char: GameState["characters"][CharId];
  canEdit: boolean;
  send: (i: Intent) => void;
  board: BoardSnapshot;
  advances?: boolean;
}) {
  if (powers.length === 0) return null;
  return (
    <Section title={title}>
      {advances && (
        <p className="mono text-[0.65rem] text-paper-fade italic mb-2 -mt-1">
          Locked until you drink Übermensch (mini-boss) blood{canEdit ? " — then tap unlock" : ""}.
        </p>
      )}
      {powers.map((p) => {
        const locked = advances ? !char.unlockedAdvances.includes(p.id) : false;
        // A no-die active that drops Challenge from the sheet (Tethered Phantom / Hellish Screech, #35)
        // gets its own target-picker control instead of the generic "spend" button — the intent spends
        // the Blood server-side, so we don't also fire change_blood here.
        const challengeActive = p.mechanic === "active" && p.sheetChallengeReduction;
        // A no-die active that arms a cross-turn stance (Iryna's #36): its own arm/transform control,
        // also Blood-spent server-side, so no generic "spend" button either.
        const stanceActive = p.mechanic === "active" && p.setsStance;
        return (
          <div key={p.id} className={`mb-2 border-b border-paper-shadow/40 pb-2 ${locked ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="mono text-sm font-bold flex-1">{p.name}</span>
              <span className="mono text-[0.6rem] uppercase text-paper-fade">{p.mechanic}{p.bloodCost ? ` · ${p.bloodCost} blood` : ""}</span>
              {advances && locked && canEdit && (
                <button className="mono text-xs underline text-blood" title="Drank Übermensch blood" onClick={() => send({ kind: "unlock_advance", seat, advanceId: p.id })}>
                  unlock
                </button>
              )}
              {!locked && canEdit && p.mechanic === "active" && !challengeActive && !stanceActive && p.bloodCost && char.blood >= p.bloodCost && (
                <button className="mono text-xs underline text-blood" onClick={() => send({ kind: "change_blood", seat, delta: -(p.bloodCost ?? 0), reason: p.name })}>
                  spend {p.bloodCost}
                </button>
              )}
            </div>
            <div className="mono text-[0.7rem] text-paper-fade">{p.text}</div>
            {p.bonus && <div className="mono text-[0.65rem] text-paper-fade">+{p.bonus.plus} when “{p.bonus.tag}”</div>}
            {!locked && canEdit && challengeActive && (
              <ChallengeReductionControl power={p} seat={seat} blood={char.blood} board={board} send={send} />
            )}
            {!locked && stanceActive && (
              <StanceControl power={p} seat={seat} char={char} board={board} canEdit={canEdit} send={send} />
            )}
          </div>
        );
      })}
    </Section>
  );
}

/**
 * The −1-Challenge no-die active control (Tethered Phantom / Hellish Screech, #35): pick a lowerable
 * target on the board, then `use_power` — the server spends the Blood and drops the Challenge through
 * the lowerChallenge gate. Only targets that can actually drop are offered: Objectives (Tethered Phantom
 * only) and in-play Threats with Challenge left that aren't a Werhund's locked Challenge (#25).
 */
function ChallengeReductionControl({
  power,
  seat,
  blood,
  board,
  send,
}: {
  power: Power;
  seat: CharId;
  blood: number;
  board: BoardSnapshot;
  send: (i: Intent) => void;
}) {
  const reduction = power.sheetChallengeReduction!;
  const cost = power.bloodCost ?? 0;
  const [targetId, setTargetId] = useState("");
  const objectives = reduction.scope === "objective_or_threat" ? board.objectives.filter((o) => (o.challenge ?? 0) > 0) : [];
  const threats = board.threats.filter((t) => threatInPlay(t) && (t.challenge ?? 0) > 0 && !isChallengeUnlowerable(t));
  const targets = [...objectives, ...threats];

  if (targets.length === 0) {
    return <div className="mono text-[0.62rem] text-paper-fade italic mt-1">No lowerable Challenge in play.</div>;
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <select
        className="mono text-xs px-1 py-0.5 bg-paper-shadow/40 flex-1 min-w-0"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        aria-label="Challenge target"
      >
        <option value="">−1 Challenge to…</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>{t.name} (Challenge {t.challenge})</option>
        ))}
      </select>
      <button
        className="mono text-xs underline text-blood disabled:opacity-40 shrink-0"
        disabled={!targetId || blood < cost}
        title={blood < cost ? `Needs ${cost} Blood` : undefined}
        onClick={() => {
          if (!targetId) return;
          send({ kind: "use_power", seat, powerId: power.id, targetId });
          setTargetId("");
        }}
      >
        use{cost ? ` (${cost})` : ""}
      </button>
    </div>
  );
}

/**
 * The cross-turn stance control (Iryna's #36 actives): arm a stance from the sheet via `set_stance`
 * (the server spends the Blood). The two `next-turn` stances (Hell's Ravenous Fire, Enervation) arm
 * with one tap and show an "armed — next turn" badge once held; Mantle of the Fell Beast needs an
 * Objective to bind to (the one whose completion ends it) and shows "active until …" while it holds.
 * The badge renders for everyone; the controls only for the owner/GM (canEdit).
 */
function StanceControl({
  power,
  seat,
  char,
  board,
  canEdit,
  send,
}: {
  power: Power;
  seat: CharId;
  char: CharacterRuntime;
  board: BoardSnapshot;
  canEdit: boolean;
  send: (i: Intent) => void;
}) {
  const spec = power.setsStance!;
  const cost = power.bloodCost ?? 0;
  const [objectiveId, setObjectiveId] = useState("");

  if (spec.kind === "mantle") {
    const active = activeMantle(char, board.objectives);
    if (active) {
      return (
        <div className="mono text-[0.62rem] text-blood mt-1">⚝ Active until {active.objectiveName ?? "the Objective"} is completed.</div>
      );
    }
    const objectives = board.objectives.filter((o) => o.rating > 0);
    if (!canEdit) return null;
    if (objectives.length === 0) {
      return <div className="mono text-[0.62rem] text-paper-fade italic mt-1">No Objective in play to bind to.</div>;
    }
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <select
          className="mono text-xs px-1 py-0.5 bg-paper-shadow/40 flex-1 min-w-0"
          value={objectiveId}
          onChange={(e) => setObjectiveId(e.target.value)}
          aria-label="Mantle Objective"
        >
          <option value="">until Objective…</option>
          {objectives.map((o) => (
            <option key={o.id} value={o.id}>{o.name} (rating {o.rating})</option>
          ))}
        </select>
        <button
          className="mono text-xs underline text-blood disabled:opacity-40 shrink-0"
          disabled={!objectiveId || char.blood < cost}
          title={char.blood < cost ? `Needs ${cost} Blood` : undefined}
          onClick={() => {
            if (!objectiveId) return;
            send({ kind: "set_stance", seat, powerId: power.id, objectiveId });
            setObjectiveId("");
          }}
        >
          transform{cost ? ` (${cost})` : ""}
        </button>
      </div>
    );
  }

  // next-turn stances: ignore-threat-challenge / enervation.
  const armed = (char.stances ?? []).some((s) => s.kind === spec.kind);
  if (armed) {
    return <div className="mono text-[0.62rem] text-dusk-mauve mt-1">⚡ Armed — applies on your next turn.</div>;
  }
  if (!canEdit) return null;
  return (
    <div className="mt-1.5">
      <button
        className="mono text-xs underline text-blood disabled:opacity-40"
        disabled={char.blood < cost}
        title={char.blood < cost ? `Needs ${cost} Blood` : "Arm this for your next turn"}
        onClick={() => send({ kind: "set_stance", seat, powerId: power.id })}
      >
        arm{cost ? ` (${cost})` : ""}
      </button>
    </div>
  );
}

