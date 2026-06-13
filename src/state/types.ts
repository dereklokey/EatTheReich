import type {
  Objective,
  Threat,
  SecondaryObjective,
  Stat,
  DieFace,
} from "../domain/types.js";
import type { InjuryTrack, InjuryOutcome } from "../engine/injury.js";
import type { PlayerDie } from "../engine/dice.js";
import type { PoolSource } from "../engine/playerPool.js";
import type { Allocation } from "../engine/allocate.js";
import type { Equipment } from "../domain/character.js";
import type { CharId, SeatId, TrafficColor } from "../events/types.js";
import type { TurnPhase } from "../engine/index.js";

/**
 * The reduced game state — `state = reduce(events)` (CLAUDE.md §3.1). This is what
 * the board, sheets, and resolution theater render from. Presence/online status is
 * NOT here (it's transient, §3A); only durable, replayable state lives in the log.
 */
export interface GameState {
  gameId: string;
  createdAt: number;
  /** seq of the last applied event (0 = nothing applied yet). */
  seq: number;
  lifecycle: "lobby" | "playing" | "ended";

  session: { number: number; active: boolean };
  round: number;

  safety: SafetyState;
  seats: Record<SeatId, SeatState>;
  board: BoardSnapshot;
  characters: Record<CharId, CharacterRuntime>;

  /** Non-null while a turn is mid-resolution (the theater). */
  currentTurn: TurnState | null;
  activeSeat: CharId | null;
  /** Characters who have completed a turn this round (RULES §1). */
  actedThisRound: CharId[];

  /**
   * Freeform out-of-turn rolls (issue #17): the last dice each seat threw outside a turn, kept for the
   * sheet's / GM panel's "dice bar" readout. Replaced on each fresh throw; persists across reloads since
   * it's reduced from the log. The arena *animation* is fired off the FREEFORM_ROLLED event in the feed,
   * NOT from here, so resuming a game shows the last value on the sheet without re-throwing the dice.
   * Keyed by seat ("gm" or a CharId); a missing entry = that seat has never freeform-rolled.
   */
  freeformRolls: Partial<Record<SeatId, FreeformRoll>>;
}

/** The result of one freeform roll (issue #17), parked per seat for the sheet/panel readout. */
export interface FreeformRoll {
  /** Die colour — vampire ("player") or the Reich's bone dice ("gm"); set from the rolling seat. */
  kind: "player" | "gm";
  faces: DieFace[];
}

export interface SafetyState {
  lines: string[];
  veils: string[];
  calibration: string[];
  traffic: TrafficColor | null;
  xcardRaised: boolean;
}

export interface SeatState {
  claimed: boolean;
  /** Durable proof of seat ownership (§3.6). Hash only — never the raw token. */
  seatTokenHash?: string;
}

export interface BoardSnapshot {
  objectives: Objective[];
  threats: Threat[];
  secondaryObjectives: SecondaryObjective[];
  /** The reference location last loaded (data/locations.ts). Names the current scene on
   *  the board and surfaces that location's special loot. Undefined for a hand-built board. */
  locationId?: string;
  /**
   * Names of the scene's "Loot within reach" items the GM has revealed (issue #15). Scene loot
   * is derived from the location reference data and defaults HIDDEN — players see only items
   * in this set; the GM sees all and reveals each as the fiction offers it. Resets when a new
   * scene is framed (a fresh board). Undefined = nothing revealed yet.
   */
  revealedLoot?: string[];
}

export interface CharacterRuntime {
  id: CharId;
  blood: number; // 0–10, starts 0
  injuries: InjuryTrack;
  /** Penalty labels from marked 2nd boxes (RULES §5). */
  triggeredPenalties: string[];
  /** Remaining uses per item id (omitted = unlimited / not use-tracked). */
  equipmentUses: Record<string, number>;
  /**
   * Item ids rusted to uselessness by the Rust-Witch's Rust Curse (issue #13). Distinct from
   * merely spent (0 uses through normal use): persists the *why* on the sheet — a struck-out
   * "rusted" marker — until the GM hands a use back (EQUIPMENT_RESTORED) to repair it.
   */
  degradedEquipment: string[];
  unlockedAdvances: string[];
  loot: Equipment[];
  /** Active loot-slot item id (RULES §11 — exactly one active at a time). */
  activeLootSlot?: string;
  downed: boolean;
  /**
   * Downed and not rescued before the scene moved on (RULES §5). Set when the GM completes the last
   * in-play main Objective with this vampire still Downed; cleared if the rescue Secondary is later
   * completed (rescued in a subsequent scene). A more severe display state than {@link downed}.
   */
  captured: boolean;
  /**
   * The auto-spawned rescue Secondary Objective for this Downed vampire (RULES §5). Set alongside
   * {@link downed}; cleared when they're rescued/healed back up. Lets the sheet/board link the
   * vampire to "Rescue <name>" and lets capture detection skip the board lookup.
   */
  rescueObjectiveId?: string;
  dead: boolean;
  /** Reset to false on SESSION_STARTED (RULES §9). */
  flashbackUsedThisSession: boolean;
  /**
   * Cross-turn stances armed by Iryna's no-die actives (#36; rulebook p57): each buffs a FUTURE
   * action and is carried here until consumed/applied (see {@link ActiveStance}). The `next-turn`
   * stances (Hell's Ravenous Fire, Enervation) clear at the actor's next TURN_STARTED; `mantle`
   * persists — but is read through {@link import("./stances.js").activeMantle}, which gates it on the
   * bound Objective still being in play, so completing the Objective by ANY path ends it (no clear
   * event needed). Absent/empty for everyone else. A spent-but-uncleared mantle may linger here
   * harmlessly; the derive keeps it inactive and re-arming overwrites it.
   */
  stances?: ActiveStance[];
}

/**
 * A cross-turn stance held on a character (Iryna's #36 advances; see
 * {@link import("../domain/character.js").Power.setsStance}). The numeric/flag fields are snapshotted
 * from the power's {@link import("../domain/character.js").StanceSpec} at activation so the
 * reducer/client never re-look-up the descriptor.
 */
export interface ActiveStance {
  kind: "ignore-threat-challenge" | "enervation" | "mantle";
  powerId: string;
  powerName: string;
  /** Enervation: flat rating damage its granted SPECIAL inflicts on an Übermensch. */
  damage?: number;
  /** Mantle: the transform applied to stats + the item lock (snapshotted from StanceSpec). */
  highStats?: Stat[];
  highValue?: number;
  lowValue?: number;
  blocksItems?: boolean;
  /** Mantle: the Objective whose completion ends the stance. */
  objectiveId?: string;
  objectiveName?: string;
}

/** Resolution-theater state for the in-progress turn (RULES §4 pipeline). */
export interface TurnState {
  seat: CharId;
  phase: TurnPhase;
  /** A Last Stand (RULES §5): the dying vampire's final 8d6, allocated freely, then
   *  they retire. Skips the GM pool, discard, and injury check; not a normal turn. */
  lastStand?: boolean;
  stat?: Stat;
  tags: string[];

  playerPool?: { total: number; sources: PoolSource[] };
  gmPoolSize?: number;
  playerDice?: DieFace[];
  gmDice?: DieFace[];
  survivors?: PlayerDie[];
  gmSuccessCount?: number;

  allocations: Allocation[];
  /** Challenge units absorbed per target this turn (RULES §6). */
  challengeConsumed: Record<string, number>;
  /**
   * Extra Challenge a target soaks this turn beyond its printed value, keyed by target id
   * (Einherjar 'Painless' — the Reich's 1s raise its Challenge for this action). Set from
   * ENEMY_CHALLENGE_RAISED and fed into the allocation soak; absent until a raise fires, and
   * dropped with the turn so it never bleeds into the next action.
   */
  challengeBump?: Record<string, number>;
  /** GM Attack dice still live after Defend allocations (drives INJURY_CHECK). */
  gmDiceRemaining?: number;
  /**
   * Set at commit when a GM die got through: the rolled injury d6 + resolved outcome,
   * awaiting `resolve_injury` (RULES §4 INJURY_CHECK). While present the theater shows
   * the injury beat — the reveal + any reactive-gear window — instead of closing.
   */
  pendingInjury?: { face: DieFace; outcome: InjuryOutcome };
  /**
   * Nicole's Scavenger SPECIAL (issue #32): the salvage d6 thrown this turn — its face plus the
   * weapon it restored (1 use). Set from SCAVENGER_ROLLED so the allocation tray shows the rolled
   * die + the salvaged weapon and blocks a second throw. Per-turn; absent until the die is thrown
   * and dropped with the turn so it never bleeds into the next action. `itemId`/`itemName` are
   * omitted when the face hit an unfilled slot (a visible throw that restored nothing).
   */
  scavenge?: { face: DieFace; itemId?: string; itemName?: string };
  /**
   * Hell's Ravenous Fire (#36): this turn ignores Threat Challenge (the `eliminate` soak treats every
   * Threat's Challenge — printed AND any 'Painless' bump — as 0). Set at TURN_STARTED when the actor had
   * the `ignore-threat-challenge` stance armed (which is then consumed); absent otherwise, so it never
   * bleeds into the next turn.
   */
  ignoreThreatChallenge?: boolean;
  /**
   * Enervation of the Soul (#36): this roll grants a SPECIAL — a crit allocated to it inflicts `damage`
   * flat rating to an Übermensch (folded through the same `ratingDamage` engine path as Apex Predator).
   * Set at TURN_STARTED when the actor had the `enervation` stance armed (then consumed); absent otherwise.
   */
  enervation?: { powerId: string; powerName: string; damage: number };
}
