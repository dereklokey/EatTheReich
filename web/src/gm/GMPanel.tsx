import { useState, type ReactNode } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { Objective, Threat, SecondaryObjective, RewardItem } from "@shared/domain/types.js";
import { CHAR_IDS, type CharId, type SeatId, type GameEvent } from "@shared/events/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { threatInPlay, isChallengeUnlowerable } from "@shared/domain/types.js";
import { LOCATIONS_BY_SECTOR, LOCATIONS_BY_ID, type Sector, type LootRef } from "@shared/data/locations.js";
import { SECONDARY_OBJECTIVE_REWARDS } from "@shared/data/rewards.js";
import { seatName } from "@/game/seats";
import { Die } from "@/components/dice/Die";
import { THREAT_CATALOG, LOOT_CATALOG, loadLocation, newObjective, newLoot, newRewardGear, newSecondaryObjective, rescueObjective } from "./catalog";

/**
 * GM panel (CLAUDE.md §4) — the only GM-only surface. Frame scenes / quick-load a
 * location, add & tune Objectives and Threats (every value is an editable default,
 * §0), run end-of-round reinforcements, raise Downed rescues, and release seats.
 * Rendered as a slide-over so it never blocks the shared board.
 */
const SECTORS: Sector[] = [3, 2, 1];

export function GMPanel({
  state,
  send,
  events,
  onRewind,
  onDelete,
  onClose,
}: {
  state: GameState;
  send: (i: Intent) => void;
  events: GameEvent[];
  onRewind: (toSeq: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[65] flex justify-end">
      <button className="flex-1 bg-night-deep/70" aria-label="close" onClick={onClose} />
      <div className="w-full max-w-md h-full overflow-y-auto bg-night-top/98 border-l border-paper-shadow/30 p-4 pb-24">
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl text-paper">GM panel</h2>
          <button className="mono text-sm underline text-paper-fade" onClick={onClose}>close</button>
        </div>

        <SessionSection state={state} send={send} events={events} />
        <LocationSection state={state} send={send} hasBoard={state.board.objectives.length + state.board.threats.length > 0} />
        <ObjectivesSection state={state} send={send} />
        <SecondaryObjectivesSection state={state} send={send} />
        <ThreatsSection state={state} send={send} />
        <RescueSection state={state} send={send} />
        <GrantLootSection state={state} send={send} />
        <RewindSection state={state} events={events} onRewind={onRewind} />
        <SeatsSection state={state} send={send} />
        <DangerSection onDelete={onDelete} />
      </div>
    </div>
  );
}

/** Finish & delete the whole game (§3A). Two-step confirm — it wipes the room for good. */
function DangerSection({ onDelete }: { onDelete: () => void }) {
  const [arming, setArming] = useState(false);
  return (
    <Section title="Finish & delete game">
      <p className="mono text-[0.65rem] text-paper-fade mb-2">
        Permanently wipes this game — every event, injury, and objective — for all players. There is no undo.
      </p>
      {!arming ? (
        <button className="mono text-xs paper paper-tight text-blood" onClick={() => setArming(true)}>
          Finish & delete…
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button className="display text-paper bg-blood px-3 py-1 text-sm" style={{ borderRadius: 2 }} onClick={onDelete}>
            Delete forever
          </button>
          <button className="mono text-xs underline text-paper-fade" onClick={() => setArming(false)}>
            cancel
          </button>
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="display text-paper text-lg mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button className="mono px-1.5 bg-paper-shadow/50" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="mono w-6 text-center">{value}</span>
      <button className="mono px-1.5 bg-paper-shadow/50" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

function SessionSection({ state, send, events }: { state: GameState; send: (i: Intent) => void; events: GameEvent[] }) {
  const lastReinforce = [...events].reverse().find((e) => e.type === "REINFORCEMENTS_APPLIED");
  const log = lastReinforce?.type === "REINFORCEMENTS_APPLIED" ? lastReinforce.payload.log : undefined;
  return (
    <Section title="Session & round">
      <div className="paper paper-tight flex flex-wrap items-center gap-2 mono text-sm">
        <span>Round {state.round}</span>
        <span className="text-paper-fade">· session {state.session.number}{state.session.active ? "" : " (idle)"}</span>
        <div className="ml-auto flex gap-2">
          {state.session.active ? (
            <button className="mono text-xs underline" onClick={() => send({ kind: "end_session" })}>end session</button>
          ) : (
            <button className="display bg-blood text-paper px-2 py-0.5 text-xs" style={{ borderRadius: 2 }} onClick={() => send({ kind: "start_session" })}>start session</button>
          )}
        </div>
      </div>
      <button
        className="mt-2 w-full display bg-blood text-paper py-2"
        style={{ borderRadius: 2 }}
        onClick={() => send({ kind: "end_round" })}
        title="Roll reinforcements (escalate Attack, restore zeroed threats) and advance the round"
      >
        End round → reinforcements
      </button>

      {log && log.length > 0 && (
        <div className="mt-2 paper paper-tight">
          <div className="mono text-[0.65rem] text-paper-fade mb-1.5">Last reinforcements — the dice it rolled</div>
          <div className="flex flex-col gap-1.5">
            {log.map((l) => (
              <div key={l.threatId} className="flex items-center gap-2 mono text-xs" title={l.reason}>
                {l.restoreRoll !== undefined ? (
                  <Die kind="gm" value={l.restoreRoll as DieFace} state="success" size="1.4rem" title={`restore roll: ${l.restoreRoll}`} />
                ) : (
                  <span className="inline-block w-[1.4rem] text-center text-paper-fade">·</span>
                )}
                <span className="flex-1 truncate">{l.name}</span>
                {l.removed ? (
                  <span className="text-paper-fade italic">removed</span>
                ) : (
                  <span className="text-blood">
                    ATK {l.attackBefore}
                    {l.attackAfter !== l.attackBefore && <> → {l.attackAfter}</>}
                    {l.ratingDelta ? <span className="font-bold"> · +{l.ratingDelta} rating</span> : null}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <RustCursePrompt state={state} send={send} events={events} />
    </Section>
  );
}

/**
 * Rust-Witch 'Rust Curse' (rulebook p56, issue #13): while the Rust-Witch is in play, the
 * GM names a PC at end of round and the server rusts one of their items at random. Lives in
 * the Session section beside reinforcements — the other end-of-round escalation. Hidden until
 * a Rust-Witch is actually on the battlefield (a staged one imposes nothing, issue #12).
 */
function RustCursePrompt({ state, send, events }: { state: GameState; send: (i: Intent) => void; events: GameEvent[] }) {
  const inPlay = state.board.threats.some((t) => threatInPlay(t) && (t.rules ?? []).includes("rust-curse"));
  const firstClaimed = CHAR_IDS.find((id) => state.seats[id]?.claimed) ?? CHAR_IDS[0]!;
  const [seat, setSeat] = useState<CharId>(firstClaimed);
  const last = [...events].reverse().find((e) => e.type === "EQUIPMENT_DEGRADED");
  const degrade = last?.type === "EQUIPMENT_DEGRADED" ? last.payload : undefined;
  if (!inPlay) return null;
  return (
    <div className="mt-2 paper paper-tight">
      <div className="mono text-[0.65rem] text-paper-fade mb-1.5">Rust Curse — corrode a PC’s gear (Rust-Witch, end of round)</div>
      <div className="flex items-center gap-1.5">
        <select className="mono flex-1 min-w-0 px-2 py-1 bg-paper text-paper-ink" value={seat} onChange={(e) => setSeat(e.target.value as CharId)} title="who the curse falls on">
          {CHAR_IDS.map((id) => (
            <option key={id} value={id}>{seatName(id)}{state.seats[id]?.claimed ? "" : " (unclaimed)"}</option>
          ))}
        </select>
        <button
          className="shrink-0 display bg-hazard-warm text-night-deep px-2 py-1 text-sm"
          style={{ borderRadius: 2 }}
          onClick={() => send({ kind: "rust_curse", seat })}
          title="The server rolls one of this PC's items at random and rusts it into uselessness"
        >
          Rust an item
        </button>
      </div>
      {degrade && (
        <div className="mt-2 flex items-center gap-2 mono text-xs">
          <Die kind="gm" value={degrade.roll} state="success" size="1.4rem" title={`rust roll: ${degrade.roll}`} />
          <span className="flex-1 truncate">{seatName(degrade.seat)}’s {degrade.itemName}</span>
          <span className="text-blood italic">rusted</span>
        </div>
      )}
    </div>
  );
}

/**
 * Load a location's suggested board (CLAUDE.md §4) and name the scene. The picked
 * location is seeded from `board.locationId`, so the selection is maintained across
 * panel open/close, and its name is what shows on the shared board (issue #4) — no
 * separate scene textbox needed.
 */
function LocationSection({ state, send, hasBoard }: { state: GameState; send: (i: Intent) => void; hasBoard: boolean }) {
  const [sel, setSel] = useState(state.board.locationId ?? "");
  const load = () => {
    const loc = LOCATIONS_BY_ID[sel];
    if (!loc) return;
    const board = loadLocation(loc);
    send({
      kind: "frame_scene",
      objectives: board.objectives,
      threats: board.threats,
      secondaryObjectives: board.secondaryObjectives,
      locationId: loc.id,
    });
  };
  return (
    <Section title="Load a location">
      <p className="mono text-[0.65rem] text-paper-fade mb-2">
        Drops in a scene’s suggested objectives, threats &amp; secondary objectives — all editable. Its name shows on the board and surfaces that location’s special loot.
      </p>
      <select className="mono w-full min-w-0 px-2 py-1.5 bg-paper text-paper-ink" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">— pick a location —</option>
        {SECTORS.map((s) => (
          <optgroup key={s} label={`Sector ${s}`}>
            {LOCATIONS_BY_SECTOR[s].map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        className="mt-2 w-full display bg-dusk-mauve text-paper py-1.5 disabled:opacity-50"
        style={{ borderRadius: 2 }}
        disabled={!sel}
        onClick={load}
      >
        Load board{hasBoard ? " (replaces current)" : ""}
      </button>
    </Section>
  );
}

const NEW_OBJECTIVE_RATING = 6;

function ObjectivesSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const [name, setName] = useState("");
  const patch = (id: string, p: Partial<Objective>) => send({ kind: "update_objective", id, patch: p });
  return (
    <Section title="Objectives">
      <div className="flex flex-col gap-1.5">
        {state.board.objectives.map((o) => (
          <div key={o.id} className="paper paper-tight mono text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1">{o.name}</span>
              {o.rating > 0 && <button className="text-xs underline text-hazard-ink" onClick={() => send({ kind: "complete_objective", id: o.id })}>done</button>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              {/* Rating and Challenge are independent (RULES §6) — both editable here. */}
              <span className="flex items-center gap-1">rating <Stepper value={o.rating} onChange={(v) => patch(o.id, { rating: v })} /></span>
              <span className="flex items-center gap-1">chal <Stepper value={o.challenge ?? 0} onChange={(v) => patch(o.id, { challenge: v })} /></span>
            </div>
          </div>
        ))}
      </div>
      {/* Add with a default rating, then tune rating/challenge on the card above. */}
      <div className="mt-2 flex gap-1.5">
        <input className="mono flex-1 min-w-0 px-2 py-1 bg-paper text-paper-ink" placeholder="new objective" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="display bg-blood text-paper px-3 text-sm disabled:opacity-40" style={{ borderRadius: 2 }}
          disabled={!name.trim()}
          onClick={() => { send({ kind: "add_objective", objective: newObjective(name.trim(), NEW_OBJECTIVE_RATING) }); setName(""); }}
        >add</button>
      </div>
    </Section>
  );
}

/**
 * Secondary objectives (issue #4 / rulebook p38) — optional side-goals. They were
 * loaded from locations but never shown anywhere; now the GM can see, tune, complete
 * (the player picks a reward from the p38 menu), and clear them. Progress is manual
 * (the rating stepper), matching the "suggest, don't enforce" model for objectives.
 */
const NEW_SECONDARY_RATING = 4;

function SecondaryObjectivesSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const [name, setName] = useState("");
  const list = state.board.secondaryObjectives;
  return (
    <Section title="Secondary objectives">
      <p className="mono text-[0.65rem] text-paper-fade mb-2">
        Optional side-goals. Complete one and the player chooses a reward (rulebook p38).
      </p>
      {list.length === 0 ? (
        <p className="mono text-xs text-paper-fade italic">None in play. Load a location or add one below.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map((o) => <SecondaryRow key={o.id} o={o} state={state} send={send} />)}
        </div>
      )}
      {/* Add with a default rating, then tune rating/challenge on the card above. */}
      <div className="mt-2 flex gap-1.5">
        <input className="mono flex-1 min-w-0 px-2 py-1 bg-paper text-paper-ink" placeholder="new secondary objective" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="display bg-blood text-paper px-3 text-sm disabled:opacity-40" style={{ borderRadius: 2 }}
          disabled={!name.trim()}
          onClick={() => { send({ kind: "add_secondary_objective", objective: newSecondaryObjective(name.trim(), NEW_SECONDARY_RATING) }); setName(""); }}
        >add</button>
      </div>
    </Section>
  );
}

function SecondaryRow({ o, state, send }: { o: SecondaryObjective; state: GameState; send: (i: Intent) => void }) {
  const [reward, setReward] = useState("");
  const [rewardTarget, setRewardTarget] = useState(""); // chosen Objective/Threat id, or seat for +Blood (#37)
  const firstClaimed = CHAR_IDS.find((id) => state.seats[id]?.claimed) ?? CHAR_IDS[0]!;
  const [recipient, setRecipient] = useState<CharId>(firstClaimed);
  const done = o.rating <= 0;
  const gear = o.rewardEquipment ?? [];
  const hasGear = gear.length > 0;
  const rewardLabel = (id?: string) => SECONDARY_OBJECTIVE_REWARDS.find((r) => r.id === id)?.label;
  // p38 reward auto-apply (#37): show a target picker scoped to the chosen reward's kind. The d6 is
  // rolled server-side; here we only name where it lands (or who gains Blood).
  const rewardKind = SECONDARY_OBJECTIVE_REWARDS.find((r) => r.id === reward)?.kind;
  const objectiveTargets = state.board.objectives.filter((t) => t.rating > 0);
  const threatTargets = state.board.threats.filter(threatInPlay);
  const challengeTargets = [
    ...state.board.objectives.filter((t) => (t.challenge ?? 0) > 0),
    ...state.board.threats.filter((t) => threatInPlay(t) && (t.challenge ?? 0) > 0 && !isChallengeUnlowerable(t)),
  ];
  const completeReward =
    rewardKind === "blood" && rewardTarget ? { rewardSeat: rewardTarget as CharId }
    : rewardKind && rewardKind !== "blood" && rewardKind !== "equipment" && rewardTarget ? { rewardTargetId: rewardTarget }
    : {};
  const patch = (p: Partial<SecondaryObjective>) => send({ kind: "update_secondary_objective", id: o.id, patch: p });
  // Slot-free gear (rulebook p39): granted as a no-slot asset to one player on completion.
  const grant = (g: RewardItem) => send({ kind: "loot_add", seat: recipient, item: newRewardGear(g.name, g.bonus, g.note) });
  // Staged reveal (issue #15): an unrevealed secondary is hidden from players — dim its info
  // (not the buttons) and offer the reveal toggle, mirroring staged threats.
  const isHidden = o.revealed === false;
  const dim = isHidden ? "opacity-30" : "";

  return (
    <div className="paper paper-tight mono text-sm">
      <div className="flex items-center gap-2">
        <span className={`flex-1 ${dim} ${done ? "line-through text-paper-fade" : ""}`}>
          {o.name}
          {isHidden && <span className="mono text-[0.55rem] uppercase tracking-wide text-paper-fade border border-current px-1 ml-1.5 align-middle">hidden</span>}
        </span>
        {o.rescueFor && <span className="stamp text-[0.55rem]">rescue</span>}
        {isHidden ? (
          <button
            className="display text-paper bg-blood px-2 py-0.5 text-xs"
            style={{ borderRadius: 2 }}
            onClick={() => patch({ revealed: true })}
            title="Reveal this objective to the players"
          >
            Reveal
          </button>
        ) : (
          <button className="text-xs underline text-paper-fade" onClick={() => patch({ revealed: false })} title="Hide this objective from the players">hide</button>
        )}
        <button className="text-xs underline text-blood" onClick={() => send({ kind: "remove_secondary_objective", id: o.id })}>remove</button>
      </div>

      {done ? (
        <>
          <div className="mono text-[0.65rem] text-hazard-ink font-bold mt-1">
            ✓ complete{o.rewardChoice ? ` — reward: ${rewardLabel(o.rewardChoice) ?? o.rewardChoice}` : ""}
          </div>
          {hasGear && (
            <div className="mt-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[0.6rem] text-hazard-ink font-bold">unlocked — grant to</span>
                <select className="mono text-xs flex-1 min-w-0 px-1 py-0.5 bg-paper-shadow/40" value={recipient} onChange={(e) => setRecipient(e.target.value as CharId)}>
                  {CHAR_IDS.map((id) => (
                    <option key={id} value={id}>{seatName(id)}{state.seats[id]?.claimed ? "" : " (unclaimed)"}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                {gear.map((g, i) => (
                  <div key={i} className="flex items-center gap-2 bg-paper-shadow/30 px-2 py-1" style={{ borderRadius: 2 }}>
                    <span className="flex-1 min-w-0">
                      <span className="text-xs">{g.name}</span>
                      {g.bonus && <span className="text-[0.6rem] text-blood ml-1">{g.bonus}</span>}
                      <span className="text-[0.55rem] text-paper-fade ml-1">· no slot</span>
                    </span>
                    <button className="display bg-blood text-paper px-2 py-0.5 text-[0.65rem]" style={{ borderRadius: 2 }} onClick={() => grant(g)}>grant</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`flex items-center gap-3 mt-1 text-xs ${dim}`}>
            <span className="flex items-center gap-1">rating <Stepper value={o.rating} onChange={(v) => patch({ rating: v })} /></span>
            <span className="flex items-center gap-1">chal <Stepper value={o.challenge ?? 0} onChange={(v) => patch({ challenge: v })} /></span>
          </div>

          {hasGear ? (
            // Gear-gated secondary (rulebook p39): the reward IS the equipment, so show it
            // locked (no p38 menu) and unlock it for distribution once the objective clears.
            <>
              <div className="mt-1.5 border border-paper-shadow/40 px-2 py-1" style={{ borderRadius: 2 }}>
                <div className="text-[0.6rem] text-paper-fade mb-0.5">🔒 unlocks on completion (slot-free):</div>
                {gear.map((g, i) => (
                  <div key={i} className="text-[0.65rem] text-paper-fade">
                    {g.name}{g.bonus && <span className="text-blood/70"> {g.bonus}</span>}
                  </div>
                ))}
              </div>
              <button
                className="display bg-dusk-mauve text-paper px-3 py-0.5 text-xs mt-1.5 ml-auto block" style={{ borderRadius: 2 }}
                onClick={() => send({ kind: "complete_secondary_objective", id: o.id })}
              >
                complete &amp; unlock
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-1.5 mt-1.5">
              {/* Rescue secondaries have a fixed reward (the rescued vampire); others draw the p38 menu. */}
              {!o.rescueFor && (
                <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={reward} onChange={(e) => { setReward(e.target.value); setRewardTarget(""); }}>
                  <option value="">reward on completion…</option>
                  {SECONDARY_OBJECTIVE_REWARDS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              )}
              {/* Target picker for the auto-applied reward (#37). Scoped to the reward's kind; the d6 is
                  server-rolled. Leave it on "—" to record the choice but apply the number by hand. */}
              {rewardKind === "blood" && (
                <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={rewardTarget} onChange={(e) => setRewardTarget(e.target.value)}>
                  <option value="">— who gains the Blood? —</option>
                  {CHAR_IDS.map((id) => <option key={id} value={id}>{seatName(id)}{state.seats[id]?.claimed ? "" : " (unclaimed)"}</option>)}
                </select>
              )}
              {rewardKind === "objective" && (
                <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={rewardTarget} onChange={(e) => setRewardTarget(e.target.value)}>
                  <option value="">— which Objective? —</option>
                  {objectiveTargets.map((t) => <option key={t.id} value={t.id}>{t.name} (rating {t.rating})</option>)}
                </select>
              )}
              {(rewardKind === "threat" || rewardKind === "attack") && (
                <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={rewardTarget} onChange={(e) => setRewardTarget(e.target.value)}>
                  <option value="">— which Threat? —</option>
                  {threatTargets.map((t) => <option key={t.id} value={t.id}>{t.name} ({rewardKind === "attack" ? `attack ${t.attack}` : `rating ${t.rating}`})</option>)}
                </select>
              )}
              {rewardKind === "challenge" && (
                <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={rewardTarget} onChange={(e) => setRewardTarget(e.target.value)}>
                  <option value="">— whose Challenge? —</option>
                  {challengeTargets.map((t) => <option key={t.id} value={t.id}>{t.name} (challenge {t.challenge})</option>)}
                </select>
              )}
              <button
                className="display bg-dusk-mauve text-paper px-3 py-0.5 text-xs ml-auto" style={{ borderRadius: 2 }}
                onClick={() => send({ kind: "complete_secondary_objective", id: o.id, ...(reward ? { rewardChoice: reward } : {}), ...completeReward })}
              >
                {o.rescueFor ? "rescued" : "complete"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ThreatsSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const [pick, setPick] = useState(0);
  const patch = (id: string, p: Partial<Threat>) => send({ kind: "update_threat", id, patch: p });
  // Staging (issue #12): a Threat with active===false is placed but held off the battlefield
  // — players don't see it, it contributes no Reich dice and doesn't escalate until the GM
  // activates it. Default (no field) = in play. The GM toggles each, or activates them all.
  const staged = state.board.threats.filter((t) => t.active === false);
  return (
    <Section title="Threats">
      {staged.length > 0 && (
        <button
          className="mb-2 w-full mono text-xs underline text-paper-fade"
          onClick={() => staged.forEach((t) => patch(t.id, { active: true }))}
          title="Bring every staged threat into play"
        >
          Activate all ({staged.length} staged)
        </button>
      )}
      <div className="flex flex-col gap-1.5">
        {state.board.threats.map((t) => {
          const isStaged = t.active === false;
          // Match the board: a staged threat dims its info (name + stat steppers) but never
          // its action buttons, which would then read as disabled.
          const dim = isStaged ? "opacity-30" : "";
          return (
            <div key={t.id} className="paper paper-tight mono text-sm">
              <div className="flex items-center gap-2">
                <span className={`flex-1 ${dim}`}>
                  {t.name}
                  {isStaged && <span className="mono text-[0.55rem] uppercase tracking-wide text-paper-fade border border-current px-1 ml-1.5 align-middle">staged</span>}
                </span>
                {isStaged ? (
                  <button
                    className="display text-paper bg-blood px-2 py-0.5 text-xs"
                    style={{ borderRadius: 2 }}
                    onClick={() => patch(t.id, { active: true })}
                    title="Bring this threat into play (players will see it)"
                  >
                    Activate
                  </button>
                ) : (
                  <button
                    className="text-xs underline text-paper-fade"
                    onClick={() => patch(t.id, { active: false })}
                    title="Hold this threat off the board (hidden from players)"
                  >
                    stage
                  </button>
                )}
                <button className="text-xs underline text-blood" onClick={() => send({ kind: "remove_threat", id: t.id })}>remove</button>
              </div>
              <div className={`flex items-center gap-3 mt-1 text-xs ${dim}`}>
                <span className="flex items-center gap-1">rating <Stepper value={t.rating} onChange={(v) => patch(t.id, { rating: v })} /></span>
                <span className="flex items-center gap-1">ATK <Stepper value={t.attack} onChange={(v) => patch(t.id, { attack: v })} /></span>
                <span className="flex items-center gap-1">chal <Stepper value={t.challenge ?? 0} onChange={(v) => patch(t.id, { challenge: v })} /></span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        <select className="mono flex-1 px-2 py-1 bg-paper text-paper-ink" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
          {THREAT_CATALOG.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
        </select>
        <button
          className="display bg-blood text-paper px-2 text-sm" style={{ borderRadius: 2 }}
          onClick={() => send({ kind: "add_threat", threat: THREAT_CATALOG[pick]!.make() })}
        >add</button>
      </div>
    </Section>
  );
}

function RescueSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const downed = CHAR_IDS.filter((id) => state.characters[id]?.downed && !state.characters[id]?.dead);
  const existing = new Set(state.board.secondaryObjectives.filter((s) => s.rescueFor).map((s) => s.rescueFor));
  const need = downed.filter((id) => !existing.has(id));
  if (need.length === 0) return null;
  return (
    <Section title="Downed — rescue">
      {need.map((id) => (
        <button
          key={id}
          className="mt-1 w-full display bg-dusk-mauve text-paper py-1.5" style={{ borderRadius: 2 }}
          onClick={() => send({ kind: "add_secondary_objective", objective: rescueObjective(seatName(id), id) })}
        >
          Add rescue objective for {seatName(id)}
        </button>
      ))}
    </Section>
  );
}

function GrantLootSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const firstClaimed = CHAR_IDS.find((id) => state.seats[id]?.claimed) ?? CHAR_IDS[0]!;
  const [seat, setSeat] = useState<CharId>(firstClaimed);
  const [name, setName] = useState("");
  const [bonus, setBonus] = useState("");
  const [note, setNote] = useState("");

  const pickSuggestion = (ref: LootRef | undefined) => {
    if (!ref) return;
    setName(ref.name);
    setBonus(ref.bonus ?? "");
    setNote(ref.note ?? "");
  };
  const grant = () => {
    if (!name.trim()) return;
    send({ kind: "loot_add", seat, item: newLoot(name.trim(), bonus.trim() || undefined, note.trim() || undefined) });
    setName("");
    setBonus("");
    setNote("");
  };

  // The special loot the book lists for the currently-loaded scene (issue #4): surfaced
  // here so it's reachable per-scene, not buried in the global suggestions list.
  const loc = state.board.locationId ? LOCATIONS_BY_ID[state.board.locationId] : undefined;
  const sceneLoot = loc?.loot ?? [];
  // Staged reveal (issue #15): which scene loot the players can currently see.
  const revealedLoot = state.board.revealedLoot ?? [];

  return (
    <Section title="Grant loot">
      <p className="mono text-[0.65rem] text-paper-fade mb-2">
        Looted gear becomes equipment with 3 uses and one bonus requirement (rulebook p39). It lands in the character’s Loot, ready to activate.
      </p>
      <div className="flex flex-col gap-1.5">
        {/* min-w-0 + full-width rows keep long item names from forcing the panel to side-scroll (issue #4). */}
        <select className="mono w-full min-w-0 px-2 py-1 bg-paper text-paper-ink" value={seat} onChange={(e) => setSeat(e.target.value as CharId)} title="who receives it">
          {CHAR_IDS.map((id) => (
            <option key={id} value={id}>{seatName(id)}{state.seats[id]?.claimed ? "" : " (unclaimed)"}</option>
          ))}
        </select>

        {sceneLoot.length > 0 && (
          <div className="paper paper-tight">
            <div className="mono text-[0.6rem] text-paper-fade mb-1">Special loot in {loc!.name} — reveal to players, or tap a name to prefill a grant</div>
            <div className="flex flex-col gap-1">
              {sceneLoot.map((l, i) => {
                // Staged (issue #15): hidden from players until revealed; dim the name when hidden.
                const hidden = !revealedLoot.includes(l.name);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <button className={`mono text-[0.65rem] underline text-blood text-left flex-1 min-w-0 ${hidden ? "opacity-40" : ""}`} title={l.bonus} onClick={() => pickSuggestion(l)}>
                      {l.name}
                    </button>
                    {hidden ? (
                      <button className="shrink-0 display text-paper bg-blood px-2 py-0.5 text-[0.6rem]" style={{ borderRadius: 2 }} onClick={() => send({ kind: "set_loot_revealed", name: l.name, revealed: true })} title="Reveal to players">reveal</button>
                    ) : (
                      <button className="shrink-0 mono text-[0.6rem] underline text-paper-fade" onClick={() => send({ kind: "set_loot_revealed", name: l.name, revealed: false })} title="Hide from players">hide</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <select className="mono w-full min-w-0 px-2 py-1 bg-paper text-paper-ink" value="" onChange={(e) => pickSuggestion(LOOT_CATALOG[Number(e.target.value)])} title="prefill from any location's loot in the book">
          <option value="">all special loot (suggestions)…</option>
          {LOOT_CATALOG.map((l, i) => <option key={i} value={i}>{l.name}</option>)}
        </select>
        <input className="mono w-full min-w-0 px-2 py-1 bg-paper text-paper-ink" placeholder="item name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-1.5">
          <input className="mono flex-1 min-w-0 px-2 py-1 bg-paper text-paper-ink" placeholder="bonus, e.g. ++anti-tank" value={bonus} onChange={(e) => setBonus(e.target.value)} title="leading +'s set the bonus die count" />
          <input className="mono flex-1 min-w-0 px-2 py-1 bg-paper text-paper-ink" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          className="display bg-blood text-paper px-2 py-1 text-sm disabled:opacity-40 self-start"
          style={{ borderRadius: 2 }}
          disabled={!name.trim()}
          onClick={grant}
        >
          Grant to {seatName(seat)}
        </button>
      </div>
    </Section>
  );
}

function RewindSection({ state, events, onRewind }: { state: GameState; events: GameEvent[]; onRewind: (toSeq: number) => void }) {
  const recent = [...events].reverse().slice(0, 12);
  const label = (t: string) => t.toLowerCase().replace(/_/g, " ");
  return (
    <Section title="Rewind">
      <p className="mono text-[0.65rem] text-paper-fade mb-2">
        Undo is permanent — it drops events off the end of the log. Everyone’s screen jumps back.
      </p>
      <button
        className="w-full display bg-dusk-mauve text-paper py-1.5 disabled:opacity-40"
        style={{ borderRadius: 2 }}
        disabled={state.seq <= 1}
        onClick={() => onRewind(state.seq - 1)}
      >
        Undo last action (#{state.seq})
      </button>
      {recent.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {recent.map((e) => (
            <div key={e.seq} className="paper paper-tight flex items-center gap-2 mono text-[0.7rem]">
              <span className="text-paper-fade">#{e.seq}</span>
              <span className="flex-1">{label(e.type)} <span className="text-paper-fade">· {e.actor}</span></span>
              <button className="underline text-blood" title="rewind to just before this event" onClick={() => onRewind(e.seq - 1)}>
                ↩ before
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SeatsSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const claimed = (["gm", ...CHAR_IDS] as SeatId[]).filter((s) => state.seats[s]?.claimed && s !== "gm");
  if (claimed.length === 0) return null;
  return (
    <Section title="Seats">
      <p className="mono text-[0.65rem] text-paper-fade mb-1">Release a seat so a returning player can re-claim it (lost-token recovery).</p>
      <div className="flex flex-wrap gap-1.5">
        {claimed.map((s) => (
          <button key={s} className="mono text-xs paper paper-tight" onClick={() => send({ kind: "release_seat", seat: s })}>
            release {seatName(s)}
          </button>
        ))}
      </div>
    </Section>
  );
}
