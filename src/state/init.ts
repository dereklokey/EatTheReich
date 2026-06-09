import type { GameState, CharacterRuntime, SeatState } from "./types.js";
import type { CharId, SeatId } from "../events/types.js";
import { CHAR_IDS } from "../events/types.js";
import { emptyInjuryTrack } from "../engine/injury.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";

const SEAT_IDS: SeatId[] = ["gm", ...CHAR_IDS];

/** Per-character starting runtime (RULES §5: Blood 0; uses from the sheet pips). */
export function initCharacterRuntime(id: CharId): CharacterRuntime {
  const sheet = CHARACTERS_BY_ID[id];
  const equipmentUses: Record<string, number> = {};
  for (const item of sheet?.equipment ?? []) {
    if (item.uses !== undefined) equipmentUses[item.id] = item.uses;
  }
  return {
    id,
    blood: 0,
    injuries: emptyInjuryTrack(),
    triggeredPenalties: [],
    equipmentUses,
    degradedEquipment: [],
    unlockedAdvances: [],
    loot: [],
    downed: false,
    captured: false,
    dead: false,
    flashbackUsedThisSession: false,
  };
}

/** The empty state a fresh game reduces from (before GAME_CREATED). */
export function initialState(gameId: string): GameState {
  const seats = Object.fromEntries(
    SEAT_IDS.map((s): [SeatId, SeatState] => [s, { claimed: false }]),
  ) as Record<SeatId, SeatState>;

  const characters = Object.fromEntries(
    CHAR_IDS.map((c): [CharId, CharacterRuntime] => [c, initCharacterRuntime(c)]),
  ) as Record<CharId, CharacterRuntime>;

  return {
    gameId,
    createdAt: 0,
    seq: 0,
    lifecycle: "lobby",
    session: { number: 0, active: false },
    round: 1,
    safety: { lines: [], veils: [], calibration: [], traffic: null, xcardRaised: false },
    seats,
    board: { objectives: [], threats: [], secondaryObjectives: [] },
    characters,
    currentTurn: null,
    activeSeat: null,
    actedThisRound: [],
  };
}
