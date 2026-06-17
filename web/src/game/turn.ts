import type { GameState } from "@shared/state/types.js";
import type { CharId } from "@shared/events/types.js";

/**
 * Validate the transient "who is prepping a turn" pointer (§3A) against authoritative state
 * before any "<X> is taking a turn…" banner trusts it.
 *
 * `composingSeat` is in-memory room state that is DISCARDED when the Durable Object hibernates
 * (see room.ts). A client that opens the Turn Composer and then sits idle long enough for the DO
 * to sleep keeps a React-state mirror the server can no longer clear with a delta broadcast — so
 * after that seat actually takes and completes its turn, the stale pointer re-surfaces and strands
 * the banner ("turn isn't getting correctly ended", #46/#50). Authoritative, event-sourced state
 * always wins: a seat can't be *about* to take a turn if a turn is already live, it has already
 * acted this round, or it's dead. In any of those cases, drop the pointer.
 */
export function liveComposingSeat(state: GameState, composingSeat: CharId | null): CharId | null {
  if (!composingSeat) return null;
  if (state.currentTurn) return null;
  if (state.actedThisRound.includes(composingSeat)) return null;
  if (state.characters[composingSeat]?.dead) return null;
  return composingSeat;
}
