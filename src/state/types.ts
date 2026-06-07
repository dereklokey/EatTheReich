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
  unlockedAdvances: string[];
  loot: Equipment[];
  /** Active loot-slot item id (RULES §11 — exactly one active at a time). */
  activeLootSlot?: string;
  downed: boolean;
  dead: boolean;
  /** Reset to false on SESSION_STARTED (RULES §9). */
  flashbackUsedThisSession: boolean;
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
  /** GM Attack dice still live after Defend allocations (drives INJURY_CHECK). */
  gmDiceRemaining?: number;
  /**
   * Set at commit when a GM die got through: the rolled injury d6 + resolved outcome,
   * awaiting `resolve_injury` (RULES §4 INJURY_CHECK). While present the theater shows
   * the injury beat — the reveal + any reactive-gear window — instead of closing.
   */
  pendingInjury?: { face: DieFace; outcome: InjuryOutcome };
}
