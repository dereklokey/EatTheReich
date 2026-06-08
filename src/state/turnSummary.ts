import type { GameState } from "./types.js";
import type { GameEvent, CharId } from "../events/types.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";
import { isBoardSpecialId } from "../engine/specials.js";

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
  // Board-granted damage SPECIALs (Crash & Burn, #23) — captured with target + damage so the
  // report shows "dealt N to X" / the kill, not the ugly namespaced id via powerName.
  const boardSpecialHits: { targetId?: string; units: number }[] = [];
  const bloodChanges: { reason: string; delta: number }[] = [];
  const passives: { id: string; detail?: string; bloodDelta?: number; gmSuccessDelta?: number }[] = [];
  let whiff: { name: string; attack: number; rating?: number } | null = null;
  let injury: { kind: "injury" | "downed"; penalty?: string; rending?: boolean } | null = null;
  let bonus = 0;
  let bonusLabel: string | undefined;
  // Einherjar 'Painless' (#19): per-action Challenge the Reich's 1s heaped onto a Threat, by id.
  const challengeBump = new Map<string, number>();
  // Vampirjäger 'Anathema' (#21): extra GM successes the Reich's 6s scored by double-counting.
  let anathemaBonus = 0;
  // Deadeye Shot / Back-Pocket Hex (#26): the Attack a crit-SPECIAL shaved off a Threat, keyed by
  // specialId so it folds into that special's "Activated …" line (parallel to the Ravenous blood fold).
  const attackCuts = new Map<string, { threatName: string; amount: number; attack: number }[]>();
  // Apex Predator (#27): the flat rating a crit-SPECIAL knocked off a Threat (DIE_ALLOCATED.ratingDamage),
  // keyed by specialId so it folds into the "Activated …" line (kill/now-N read off the final board).
  const ratingCuts = new Map<string, { targetId: string; amount: number }[]>();
  // Unnatural Endurance (#28): the GM Attack dice a targetless crit-SPECIAL shed (DIE_ALLOCATED.gmDiceReduction),
  // keyed by specialId so it folds into the "Activated …" line.
  const gmCuts = new Map<string, number[]>();
  // Sapper (#29): the Challenge a crit-SPECIAL lowered on an Objective/Threat (CHALLENGE_REDUCED),
  // keyed by specialId so it folds into that special's "Activated …" line (like the Attack-cut fold).
  const challengeCuts = new Map<string, { targetName: string; amount: number; challenge: number }[]>();
  // Nightmare Regeneration (#31): the Injury box a crit-SPECIAL cleared (HEALED with a specialId),
  // keyed by specialId so it folds into that special's "Activated …" line (like the Challenge-cut fold).
  const healClears = new Map<string, { category: 0 | 1 | 2; box: 1 | 2 }[]>();

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
        else if (e.payload.kind === "special" && e.payload.specialId) {
          if (isBoardSpecialId(e.payload.specialId)) boardSpecialHits.push({ targetId: e.payload.targetId, units: e.payload.units });
          else {
            specials.push(e.payload.specialId);
            // Apex Predator (#27): a sheet SPECIAL that carried flat rating damage — record it for the fold.
            if (e.payload.ratingDamage && e.payload.targetId) {
              const list = ratingCuts.get(e.payload.specialId) ?? [];
              list.push({ targetId: e.payload.targetId, amount: e.payload.ratingDamage });
              ratingCuts.set(e.payload.specialId, list);
            }
            // Unnatural Endurance (#28): a targetless SPECIAL that shed GM Attack dice — record it for the fold.
            if (e.payload.gmDiceReduction) {
              const list = gmCuts.get(e.payload.specialId) ?? [];
              list.push(e.payload.gmDiceReduction);
              gmCuts.set(e.payload.specialId, list);
            }
          }
        }
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
        injury = { kind: "injury", penalty: e.payload.penalty, rending: e.payload.rending };
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
      case "THREAT_ATTACK_REDUCED": {
        const list = attackCuts.get(e.payload.specialId) ?? [];
        list.push({ threatName: e.payload.threatName, amount: e.payload.amount, attack: e.payload.attack });
        attackCuts.set(e.payload.specialId, list);
        break;
      }
      case "CHALLENGE_REDUCED": {
        const list = challengeCuts.get(e.payload.specialId) ?? [];
        list.push({ targetName: e.payload.targetName, amount: e.payload.amount, challenge: e.payload.challenge });
        challengeCuts.set(e.payload.specialId, list);
        break;
      }
      case "HEALED": {
        // Only a crit-SPECIAL heal (Nightmare Regeneration, #31) carries a specialId — a manual
        // sheet heal doesn't, and isn't part of a turn's allocation story, so it's skipped here.
        if (e.payload.specialId) {
          const list = healClears.get(e.payload.specialId) ?? [];
          list.push({ category: e.payload.category, box: e.payload.box });
          healClears.set(e.payload.specialId, list);
        }
        break;
      }
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
    // Pair each activation with its Attack cut in order (#26) — a crit on Deadeye/Hex shaved a Threat.
    const cut = attackCuts.get(sid)?.shift();
    const cutText = cut ? ` — ${cut.threatName}'s Attack −${cut.amount} (now ${cut.attack})` : "";
    // Flat rating cut from a sheet SPECIAL: Apex Predator (#27) on a Threat, Elbow Grease (#30) on an
    // Objective. Read the now-rating/kill|completion off the final board; owns the kill/completion
    // line only when no eliminate/advance die already claims it (mirrors the Crash & Burn dedup).
    const rcut = ratingCuts.get(sid)?.shift();
    let ratingText = "";
    if (rcut) {
      const t = state.board.threats.find((x) => x.id === rcut.targetId);
      if (t) {
        if (t.rating <= 0 && !eliminate.has(rcut.targetId)) ratingText = ` — Eliminated ${t.name}!`;
        else ratingText = ` — ${t.name} −${rcut.amount} rating (now ${t.rating})`;
      } else {
        const o = state.board.objectives.find((x) => x.id === rcut.targetId);
        const oname = o?.name ?? "an objective";
        if (o && o.rating <= 0 && !advance.has(rcut.targetId)) ratingText = ` — Completed ${oname}!`;
        else ratingText = ` — ${oname} −${rcut.amount} rating (now ${o?.rating ?? "?"})`;
      }
    }
    // Unnatural Endurance (#28): a targetless "big Defend" — fold the shed GM Attack dice in.
    const gmCut = gmCuts.get(sid)?.shift();
    const gmText = gmCut ? ` — −${gmCut} Reich Attack ${plural(gmCut, "die", "dice")}` : "";
    // Sapper (#29): fold the Challenge cut in (parallel to the Attack cut) — Objective or Threat.
    const chalCut = challengeCuts.get(sid)?.shift();
    const chalText = chalCut ? ` — ${chalCut.targetName}'s Challenge −${chalCut.amount} (now ${chalCut.challenge})` : "";
    // Nightmare Regeneration (#31): fold in the wound this crit cleared, named off the seat's sheet.
    const heal = healClears.get(sid)?.shift();
    const woundLabel = heal ? CHARACTERS_BY_ID[seat]?.injuries[heal.category]?.boxes[heal.box - 1]?.label : undefined;
    const healText = heal ? ` — cleared an Injury${woundLabel ? ` (${woundLabel})` : ""}` : "";
    lines.push({ kind: "special", emphasis: true, text: `Activated ${name}${grant ? ` (+${grant.delta} Blood)` : ""}${cutText}${ratingText}${gmText}${chalText}${healText}` });
  }

  // Board-granted damage SPECIALs (Crash & Burn, #23): the crit inflicted a flat amount on the
  // granting Threat. If it finished the Threat AND no eliminate die already claims the kill, this
  // line owns the kill; otherwise it just reports the damage (the eliminate loop owns the kill).
  for (const h of boardSpecialHits) {
    const t = state.board.threats.find((x) => x.id === h.targetId);
    const name = t?.name ?? "the enemy";
    if (t && t.rating <= 0 && !eliminate.has(h.targetId ?? "")) lines.push({ kind: "kill", emphasis: true, text: `Crash & Burn — Eliminated ${name}!` });
    else lines.push({ kind: "special", emphasis: true, text: `Crash & Burn — dealt ${h.units} to ${name}${t ? ` (now ${t.rating})` : ""}` });
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
  else if (injury?.kind === "injury")
    // Rending Claws (#24) filled the whole category — name the Werhund so the table sees why
    // a single hit cost both boxes.
    lines.push({ kind: "injury", emphasis: true, text: `${injury.rending ? "Rending Claws — the whole wound opens" : "Took an Injury"}${injury.penalty ? ` — ${injury.penalty}` : ""}` });

  if (lines.length === 0) return null;
  return { seat, charName: CHARACTERS_BY_ID[seat]?.name ?? seat, lines };
}
