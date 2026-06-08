import type {
  DieFace,
  Objective,
  Threat,
  SecondaryObjective,
  Stat,
} from "../domain/types.js";
import type { Equipment } from "../domain/character.js";
import type { AllocationKind } from "../engine/allocate.js";
import type { PoolSource } from "../engine/playerPool.js";
import type { InjuryOutcome } from "../engine/injury.js";
import type { ReinforceLogEntry } from "../engine/reinforcements.js";

/**
 * Event taxonomy (CLAUDE.md §3.2). State = reduce(events). Every mutation is an
 * appended, immutable event carrying {id, gameId, seq, actor, ts, type, payload}.
 *
 * Server-authoritative (§3.1): the server validates intents, rolls dice, and
 * computes results, then appends events. **Computed randomness is captured in the
 * event** (DICE_ROLLED.results, REINFORCEMENTS_APPLIED.threats) so replay is
 * deterministic and never re-rolls.
 *
 * NOT events (transient, never logged): HEARTBEAT and presence/online status (§3A).
 */

export const CHAR_IDS = ["iryna", "nicole", "cosgrave", "chuck", "astrid", "flint"] as const;
export type CharId = (typeof CHAR_IDS)[number];

/** A seat is the GM or one of the six characters. */
export type SeatId = "gm" | CharId;
/** Who caused an event. */
export type Actor = SeatId | "system";

export type TrafficColor = "red" | "amber" | "green";

/** Metadata wrapping every event. `seq` is the 1-based append order in the log. */
export interface EventMeta {
  id: string;
  gameId: string;
  seq: number;
  actor: Actor;
  ts: number;
}

/** Discriminated payload map: event type → payload shape. */
export interface EventPayloads {
  GAME_CREATED: { createdAt: number };
  PLAYER_JOINED: { displayName?: string };
  ROLE_CLAIMED: { seat: SeatId; seatTokenHash?: string };
  SEAT_RELEASED: { seat: SeatId };
  SESSION_STARTED: Record<string, never>;
  SESSION_ENDED: Record<string, never>;

  SAFETY_SET: { lines?: string[]; veils?: string[]; calibration?: string[] };
  XCARD_RAISED: { anonymous?: boolean; note?: string };
  XCARD_CLEARED: { changeRequested?: string };
  TRAFFIC_SIGNAL: { color: TrafficColor };

  SCENE_FRAMED: {
    objectives: Objective[];
    threats: Threat[];
    secondaryObjectives?: SecondaryObjective[];
    /** The reference location this board came from — names the scene + surfaces its loot. */
    locationId?: string;
  };
  OBJECTIVE_ADDED: { objective: Objective };
  OBJECTIVE_UPDATED: { id: string; patch: Partial<Objective> };
  OBJECTIVE_COMPLETED: { id: string; narratedBy?: CharId };
  THREAT_ADDED: { threat: Threat };
  THREAT_UPDATED: { id: string; patch: Partial<Threat> };
  THREAT_REMOVED: { id: string };
  /**
   * GM-whiff escalation (RULES §8, rulebook p38): the Reich's Attack roll landed zero
   * successes, so the anchor (lead) Threat presses the attack — Attack +1 — at the moment
   * the action concluded. Distinct from THREAT_UPDATED (a GM edit) so the log reads as the
   * fiction it is and the client can sound the callout. `attack` is the resolved new value
   * (deterministic on replay).
   */
  /** `rating` is the resolved new rating, present only when the whiffed anchor is a Paratrooper
   *  'Rapid Deployment' (#22): its +1 Attack is a Reinforcement bump, so the rating climbs +2. */
  GM_WHIFF: { threatId: string; name: string; attack: number; rating?: number };

  TURN_STARTED: { seat: CharId; stat?: Stat; tags?: string[] };
  /** Abort an in-progress turn without it counting as the character's action. */
  TURN_CANCELLED: { seat: CharId };
  POOL_BUILT: { who: "player" | "gm"; dice: number; sources?: PoolSource[] };
  DICE_ROLLED: { who: "player" | "gm"; results: DieFace[] };
  PASSIVE_APPLIED: {
    passiveId: string;
    detail?: string;
    bloodDelta?: number;
    gmSuccessDelta?: number;
  };
  /** `gmSuccessCount` is the post-Anathema, post-passive total. `anathemaBonus` records the
   *  +successes the Vampirjäger's 'Anathema' (#21) added by double-scoring 6s — display-only,
   *  for the after-action report; the reducer reads only `gmSuccessCount`. */
  DICE_DISCARDED: { playerSurvivors?: DieFace[]; gmSuccessCount?: number; anathemaBonus?: number };
  /**
   * An enemy special raised its own Challenge for THIS action (Einherjar 'Painless', rulebook
   * p55: each 1 in the Reich's Attack roll bumps the Einherjar's Challenge by 1). Fired at the
   * roll-results window after the GM roll, off the aggregate pool's 1s; the reducer parks the
   * raise on the turn so the allocation soak matches, and it resets next turn. A logged,
   * GM-overridable default (CLAUDE.md §0). `amount` is the raise (= `ones` for Painless).
   */
  ENEMY_CHALLENGE_RAISED: { threatId: string; threatName: string; amount: number; ones: number; rule: string };
  /**
   * A crit-SPECIAL knocked a Threat's Attack rating down (Iryna's Deadeye Shot / Cosgrave's
   * Back-Pocket Hex, both −1; rulebook pp51/57). Fired from the ALLOCATE branch when a crit is
   * spent on a `reduceThreatAttack` SPECIAL that carries a target Threat — the player's analogue
   * of Ravenous's self-buff BLOOD_CHANGED, but it needs a picked target so it lands as its own
   * fiction-carrying event (like GM_WHIFF). `attack` is the resolved new value (clamped ≥0,
   * deterministic on replay); `specialId`/`specialName` let the after-action report fold the
   * reduction into the "Activated …" line. A logged, GM-overridable default (CLAUDE.md §0).
   */
  THREAT_ATTACK_REDUCED: { threatId: string; threatName: string; amount: number; attack: number; specialId: string; specialName: string };
  /**
   * A crit-SPECIAL lowered an Objective- or Threat's Challenge (Nicole's Sapper, −1; rulebook p59,
   * "when you use explosives"). Fired from the ALLOCATE branch when a crit is spent on a
   * `reduceChallenge` SPECIAL that carries a target — the Objective/Threat counterpart of
   * THREAT_ATTACK_REDUCED. `challenge` is the resolved new value, already routed through engine
   * `lowerChallenge`, so the Werhund's 'Unlowerable Challenge' (#25) is respected: the event is
   * ONLY emitted when the value actually dropped. `targetKind` says which board list holds the
   * target; `specialId`/`specialName` let the after-action report fold the cut into the "Activated …"
   * line. A logged, GM-overridable default (CLAUDE.md §0).
   */
  CHALLENGE_REDUCED: { targetId: string; targetName: string; targetKind: "objective" | "threat"; amount: number; challenge: number; specialId: string; specialName: string };
  /**
   * Mid-allocation bonus dice (RULES §4 — the pool is NOT frozen at roll time). A newly
   * narrated advantage adds `count` dice now; the server rolls and discards them, and the
   * survivors join the allocation tray. `label` tags their pool source.
   */
  BONUS_DICE_ROLLED: { results: DieFace[]; survivors: DieFace[]; count: number; label?: string };
  DIE_ALLOCATED: {
    kind: AllocationKind;
    targetId?: string;
    units: number;
    specialId?: string;
    /** Flat rating damage from a sheet SPECIAL on `targetId` — a Threat (Apex Predator → 3, #27)
     *  or an Objective (Elbow Grease → 4, #30); see Allocation.ratingDamage. Server-authoritative
     *  (recomputed from the power descriptor). */
    ratingDamage?: number;
    /** GM Attack dice a targetless SPECIAL sheds this turn (Unnatural Endurance → 3, #28); see
     *  Allocation.gmDiceReduction. Server-authoritative (recomputed from the power descriptor). */
    gmDiceReduction?: number;
    detail?: string;
  };
  ALLOCATION_COMMITTED: Record<string, never>;

  /**
   * A GM Attack die got through at commit, so the INJURY_CHECK window opens — but the
   * category die has NOT been thrown yet. The wounded vampire (or GM) throws it as its
   * own beat via `roll_injury`, which lands the spectacle and parks INJURY_PENDING. This
   * split exists so the injury roll is a visible, server-authoritative throw the table
   * watches, not a value that's silently pre-rolled at commit.
   */
  INJURY_CHECK_OPENED: { seat: CharId };
  /**
   * The injury d6 has been rolled but NOT yet applied (RULES §4 INJURY_CHECK). Parks
   * the rolled face + resolved outcome on the turn so the table sees the reveal and can
   * react (Chuck's hat to shrug it off) before `resolve_injury` marks the box. `outcome`
   * is never `none` here — commit only opens the window when a GM die got through.
   */
  INJURY_PENDING: { seat: CharId; face: DieFace; outcome: InjuryOutcome };
  /** `rending` flags a wound escalated to the whole category by the Werhund's Rending Claws
   *  (rulebook p64, issue #24): `box` is 2 and `penalty` fires, but the marker tells the
   *  log/summary the category filled because the table pinned the hit on the Werhund. */
  INJURY_MARKED: { seat: CharId; category: 0 | 1 | 2; box: 1 | 2; penalty?: string; rending?: boolean };
  DOWNED: { seat: CharId; category: 0 | 1 | 2; rescueObjectiveId?: string };
  /** A marked Injury box was cleared (RULES §5). The sheet's manual heal omits `specialId`; a crit-
   *  SPECIAL heal (Astrid's Nightmare Regeneration, #31) carries `specialId`/`specialName` so the
   *  after-action report folds the clear into that special's "Activated …" line. `box` is the box
   *  that was cleared (resolved server-side from the live track), so replay reverses it deterministically. */
  HEALED: { seat: CharId; category: 0 | 1 | 2; box: 1 | 2; specialId?: string; specialName?: string };
  DEATH_LAST_STAND: { seat: CharId }; // all 6 boxes marked → opens the Last Stand (RULES §5)
  LAST_STAND_ROLLED: { seat: CharId; dice: DieFace[] }; // the final 8d6
  LAST_STAND_ENDED: { seat: CharId }; // final sacrifice allocated → the vampire retires (dead)
  BLOOD_CHANGED: { seat: CharId; delta: number; reason?: string };
  BLOOD_SHARED: { from: CharId; to: CharId; amount: number };

  EQUIPMENT_USED: { seat: CharId; itemId: string };
  EQUIPMENT_RESTORED: { seat: CharId; itemId: string };
  /**
   * Nicole's Scavenger SPECIAL (rulebook, Nicole sheet; issue #32): a crit on the SPECIAL throws a
   * salvage d6 in the arena. Player-driven (they throw it as their own theater beat, the `scavenge`
   * intent) but the SERVER rolls it — `face` is baked in so replay is deterministic and clients can't
   * fudge it. The face maps to the numbered weapon carrying that {@link Equipment.scavengerSlot};
   * `itemId`/`itemName` name the salvaged weapon and the reducer restores 1 of its uses (clamped to the
   * item's max, exactly like EQUIPMENT_RESTORED). A face with no matching slot omits the item — the
   * throw is still shown, it just restores nothing. `specialId`/`specialName` fold the salvage into that
   * SPECIAL's after-action line. A logged, GM-editable default (CLAUDE.md §0).
   */
  SCAVENGER_ROLLED: { seat: CharId; face: DieFace; specialId: string; specialName: string; itemId?: string; itemName?: string };
  /**
   * Rust Curse (rulebook p56, issue #13): the Rust-Witch corrodes one of a GM-chosen PC's
   * items into uselessness — its remaining uses are zeroed. The server picks the item at
   * random (`roll` = a d6 mapped over the eligible items, like injuries/reinforcements), so
   * it's anti-fudge and replays deterministically — the chosen `itemId` is baked in and the
   * reducer never re-rolls. A logged, GM-overridable default (CLAUDE.md §0); the GM can hand
   * uses back via EQUIPMENT_RESTORED to "repair" it.
   */
  EQUIPMENT_DEGRADED: { seat: CharId; itemId: string; itemName: string; roll: DieFace };
  LOOT_ADDED: { seat: CharId; item: Equipment };
  LOOT_ACTIVATED: { seat: CharId; itemId: string };
  ADVANCE_UNLOCKED: { seat: CharId; advanceId: string };

  SECONDARY_OBJECTIVE_ADDED: { objective: SecondaryObjective };
  SECONDARY_OBJECTIVE_UPDATED: { id: string; patch: Partial<SecondaryObjective> };
  SECONDARY_OBJECTIVE_COMPLETED: { id: string; rewardChoice?: string };
  SECONDARY_OBJECTIVE_REMOVED: { id: string };
  /** Staged loot reveal (issue #15): show/hide one scene "Loot within reach" item (by name) to players. */
  SCENE_LOOT_REVEALED: { name: string; revealed: boolean };

  /** The flashback scene is narrated out loud, not typed — the event just records who spent it. */
  FLASHBACK_TRIGGERED: { seat: CharId };
  ROUND_ENDED: Record<string, never>;
  /** `log` is the per-threat breakdown (incl. each restore's 1d6) for "shown with the dice it rolled" (CLAUDE.md §4). */
  REINFORCEMENTS_APPLIED: { threats: Threat[]; log?: ReinforceLogEntry[]; note?: string };

  /** Explicit, always-logged override (CLAUDE.md §0/§3.2). */
  GM_OVERRIDE: {
    note?: string;
    targetEventId?: string;
    patch?: { objectives?: Objective[]; threats?: Threat[] };
  };
}

export type EventType = keyof EventPayloads;

/** A single event for a given type `T`. */
export type GameEventOf<T extends EventType> = EventMeta & {
  type: T;
  payload: EventPayloads[T];
};

/** Any game event. */
export type GameEvent = { [T in EventType]: GameEventOf<T> }[EventType];

/** Build an event envelope (used by the store/tests). */
export function makeEvent<T extends EventType>(
  meta: EventMeta,
  type: T,
  payload: EventPayloads[T],
): GameEventOf<T> {
  return { ...meta, type, payload };
}
