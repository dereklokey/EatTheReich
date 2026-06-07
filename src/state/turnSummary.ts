import type { GameState } from "./types.js";
import type { GameEvent, CharId } from "../events/types.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";

/**
 * After-action report (the resolution accounting). A turn's whole story already lives in
 * its event log — allocations, the feed/defend/progress totals, SPECIALs, the *non-obvious*
 * server-side beats (Corpse Eater's +1 Blood off a rolled 1, Dead Man's Luck cancelling a
 * Reich success), the GM whiff, and any Injury. This pure selector folds the events between
 * a seat's `TURN_STARTED` and its `ALLOCATION_COMMITTED` into human lines for the UI.
 *
 * Pure + offline-testable (mirrors the engine convention). Names/ratings are read from
 * `state` as of the commit — a Threat killed this turn is still on the board at rating 0
 * (removal waits for end-of-round reinforcement), so its name resolves fine.
 */
export type SummaryKind =
  | "kill"
  | "eliminate"
  | "advance"
  | "complete"
  | "defend"
  | "feed"
  | "special"
  | "blood"
  | "passive"
  | "whiff"
  | "injury"
  | "downed"
  | "bonus"
  | "enemy";

export interface TurnSummaryLine {
  kind: SummaryKind;
  text: string;
  /** Louder treatment: kills, completions, SPECIALs, the whiff, going down. */
  emphasis?: boolean;
}

export interface TurnSummary {
  seat: CharId;
  charName: string;
  lines: TurnSummaryLine[];
}

/** Any power id (ability or advance, any character) → its display name. */
function powerName(id: string): string {
  for (const c of Object.values(CHARACTERS_BY_ID)) {
    const p = [...c.abilities, ...c.advances].find((x) => x.id === id);
    if (p) return p.name;
  }
  return id;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * Summarise the turn that closed at `committedSeq`. Returns null when that seq isn't an
 * ALLOCATION_COMMITTED, the turn can't be located, or nothing worth reporting happened.
 */
export function summarizeCommittedTurn(
  events: readonly GameEvent[],
  committedSeq: number,
  state: GameState,
): TurnSummary | null {
  const ev = [...events].sort((a, b) => a.seq - b.seq);
  const committed = ev.find((e) => e.seq === committedSeq && e.type === "ALLOCATION_COMMITTED");
  if (!committed) return null;
  const seat = committed.actor;
  if (seat === "gm" || seat === "system") return null;

  // The turn window: the seat's most recent TURN_STARTED up to this commit.
  let startSeq = -1;
  for (const e of ev) {
    if (e.seq >= committedSeq) break;
    if (e.type === "TURN_STARTED" && e.payload.seat === seat) startSeq = e.seq;
  }
  if (startSeq < 0) return null;
  const turn = ev.filter((e) => e.seq >= startSeq && e.seq <= committedSeq);

  // Aggregate the turn's effects.
  const advance = new Map<string, number>();
  const eliminate = new Map<string, number>();
  let defend = 0;
  let feed = 0;
  const specials: string[] = [];
  const bloodChanges: { reason: string; delta: number }[] = [];
  const passives: { id: string; detail?: string; bloodDelta?: number; gmSuccessDelta?: number }[] = [];
  let whiff: { name: string; attack: number; rating?: number } | null = null;
  let injury: { kind: "injury" | "downed"; penalty?: string } | null = null;
  let bonus = 0;
  let bonusLabel: string | undefined;
  // Einherjar 'Painless' (#19): per-action Challenge the Reich's 1s heaped onto a Threat, by id.
  const challengeBump = new Map<string, number>();
  // Vampirjäger 'Anathema' (#21): extra GM successes the Reich's 6s scored by double-counting.
  let anathemaBonus = 0;

  const add = (m: Map<string, number>, id: string | undefined, units: number) => {
    if (!id) return;
    m.set(id, (m.get(id) ?? 0) + units);
  };

  for (const e of turn) {
    switch (e.type) {
      case "DIE_ALLOCATED":
        if (e.payload.kind === "advance") add(advance, e.payload.targetId, e.payload.units);
        else if (e.payload.kind === "eliminate") add(eliminate, e.payload.targetId, e.payload.units);
        else if (e.payload.kind === "defend") defend += e.payload.units;
        else if (e.payload.kind === "feed") feed += e.payload.units;
        else if (e.payload.kind === "special" && e.payload.specialId) specials.push(e.payload.specialId);
        break;
      case "BLOOD_CHANGED":
        bloodChanges.push({ reason: e.payload.reason ?? "Blood", delta: e.payload.delta });
        break;
      case "PASSIVE_APPLIED":
        passives.push({ id: e.payload.passiveId, detail: e.payload.detail, bloodDelta: e.payload.bloodDelta, gmSuccessDelta: e.payload.gmSuccessDelta });
        break;
      case "GM_WHIFF":
        whiff = { name: e.payload.name, attack: e.payload.attack, rating: e.payload.rating };
        break;
      case "INJURY_MARKED":
        injury = { kind: "injury", penalty: e.payload.penalty };
        break;
      case "DOWNED":
        injury = { kind: "downed" };
        break;
      case "BONUS_DICE_ROLLED":
        bonus += e.payload.count;
        bonusLabel = bonusLabel ?? e.payload.label;
        break;
      case "ENEMY_CHALLENGE_RAISED":
        challengeBump.set(e.payload.threatId, (challengeBump.get(e.payload.threatId) ?? 0) + e.payload.amount);
        break;
      case "DICE_DISCARDED":
        anathemaBonus += e.payload.anathemaBonus ?? 0;
        break;
    }
  }

  const lines: TurnSummaryLine[] = [];
  const objName = (id: string) => state.board.objectives.find((o) => o.id === id)?.name ?? "an objective";

  // SPECIALs first — and fold any matching Blood grant (Ravenous +3) into the line.
  const foldedReasons = new Set<string>();
  for (const sid of specials) {
    const name = powerName(sid);
    const grant = bloodChanges.find((b) => b.reason === name && b.delta > 0);
    if (grant) foldedReasons.add(name);
    lines.push({ kind: "special", emphasis: true, text: `Activated ${name}${grant ? ` (+${grant.delta} Blood)` : ""}` });
  }

  // Einherjar 'Painless' (#19): the Reich's 1s steeled an enemy — surface the raise so the
  // table sees why its Challenge soaked more, even if no die was aimed at it this turn.
  for (const [id, amount] of challengeBump) {
    const name = state.board.threats.find((x) => x.id === id)?.name ?? "the enemy";
    lines.push({ kind: "enemy", text: `Painless — ${name}'s Challenge +${amount} (Reich ${plural(amount, "1", "1s")})` });
  }

  // Vampirjäger 'Anathema' (#21): the Reich's 6s struck twice — more dice got through than the
  // faces suggest, so surface the extra successes the table felt as harder incoming Attack.
  if (anathemaBonus > 0) {
    lines.push({ kind: "enemy", text: `Anathema — Reich 6s scored +${anathemaBonus} success${anathemaBonus === 1 ? "" : "es"} (struck twice)` });
  }

  // Threats: a kill (now at 0) reads loud; otherwise the rating it shed. A 'Painless' raise
  // (#19) inflates the soak, so fold it into the printed Challenge before counting the drop.
  for (const [id, units] of eliminate) {
    const t = state.board.threats.find((x) => x.id === id);
    const name = t?.name ?? "a threat";
    const reduction = Math.max(0, units - ((t?.challenge ?? 0) + (challengeBump.get(id) ?? 0)));
    if (t && t.rating <= 0) lines.push({ kind: "kill", emphasis: true, text: `Eliminated ${name}!` });
    else if (reduction > 0) lines.push({ kind: "eliminate", text: `Hit ${name} — −${reduction} rating (now ${t?.rating ?? "?"})` });
    else lines.push({ kind: "eliminate", text: `${units} ${plural(units, "success", "successes")} soaked by ${name}'s Challenge` });
  }

  // Objectives.
  for (const [id, units] of advance) {
    const o = state.board.objectives.find((x) => x.id === id);
    const name = objName(id);
    const reduction = Math.max(0, units - (o?.challenge ?? 0));
    if (o && o.rating <= 0) lines.push({ kind: "complete", emphasis: true, text: `Completed ${name}!` });
    else if (reduction > 0) lines.push({ kind: "advance", text: `Advanced ${name} — −${reduction} rating (now ${o?.rating ?? "?"})` });
    else lines.push({ kind: "advance", text: `${units} ${plural(units, "success", "successes")} soaked by ${name}'s Challenge` });
  }

  if (defend > 0) lines.push({ kind: "defend", text: `Defended ${defend} Reich ${plural(defend, "attack")}` });
  if (feed > 0) lines.push({ kind: "feed", text: `Drank deep — +${feed} Blood` });

  // Other Blood swings (cigarettes, un-folded grants).
  for (const b of bloodChanges) {
    if (!b.delta || foldedReasons.has(b.reason)) continue;
    lines.push({ kind: "blood", text: `${b.reason} — ${b.delta > 0 ? `+${b.delta}` : b.delta} Blood` });
  }

  // The quiet, easy-to-miss passives the table should still see.
  for (const p of passives) {
    const name = powerName(p.id);
    if (p.detail) lines.push({ kind: "passive", text: `${name}: ${p.detail}` });
    else if (p.bloodDelta) lines.push({ kind: "passive", text: `${name}: +${p.bloodDelta} Blood` });
    else if (p.gmSuccessDelta) lines.push({ kind: "passive", text: `${name}: −${Math.abs(p.gmSuccessDelta)} Reich ${plural(Math.abs(p.gmSuccessDelta), "success", "successes")}` });
  }

  if (bonus > 0) lines.push({ kind: "bonus", text: `Rolled ${bonus} bonus ${plural(bonus, "die", "dice")}${bonusLabel ? ` (${bonusLabel})` : ""}` });

  if (whiff)
    lines.push({
      kind: "whiff",
      emphasis: true,
      text: `Shots go wide — ${whiff.name} presses the attack (ATK +1 → ${whiff.attack}${whiff.rating !== undefined ? `, Rapid Deployment +2 rating → ${whiff.rating}` : ""})`,
    });

  if (injury?.kind === "downed") lines.push({ kind: "downed", emphasis: true, text: "Downed — out of the fight" });
  else if (injury?.kind === "injury") lines.push({ kind: "injury", emphasis: true, text: `Took an Injury${injury.penalty ? ` — ${injury.penalty}` : ""}` });

  if (lines.length === 0) return null;
  return { seat, charName: CHARACTERS_BY_ID[seat]?.name ?? seat, lines };
}
