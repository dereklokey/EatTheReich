import type { Threat } from "../domain/types.js";
import type { DiceRoller } from "../domain/dice.js";

/**
 * REINFORCEMENTS — end of round (RULES §8). Standard rules:
 *  1. Any Threat reduced to 0 THIS round: restore rating by 1d6; set Attack to
 *     floor(startingAttack / 2). (It does NOT also get the +1 from rule 2.)
 *  2. Every Threat still in play (rating > 0, and NOT one restored by rule 1):
 *     Attack +1.
 *  3. Any Threat the GM rolled zero successes against this round: Attack +1.
 *     (Applied only to threats not handled by rule 1 — golden test B expects the
 *     restored Squad to end at exactly floor(3/2) = 1.)
 *
 * Übermenschen / elites (`reinforces: false`) do not reinforce; at rating 0 they
 * die permanently and are removed.
 *
 * All results are GM-confirmable before commit (returned alongside the new state).
 */
export interface ReinforceInput {
  threats: readonly Threat[];
  /** Threat ids reduced to 0 during this round. */
  reducedToZeroThisRound: ReadonlySet<string>;
  /** Threat ids the GM rolled zero successes against this round. */
  zeroSuccessThisRound: ReadonlySet<string>;
  roller: DiceRoller;
}

export interface ReinforceResult {
  threats: Threat[];
  /** Per-threat breakdown for the GM-confirm UI. */
  log: ReinforceLogEntry[];
}

export interface ReinforceLogEntry {
  threatId: string;
  /** Threat name at reinforcement time — carried so the GM-confirm UI can show removed ones. */
  name: string;
  removed?: boolean; // übermensch killed
  restoreRoll?: number; // 1d6 applied to rating
  attackBefore: number;
  attackAfter: number;
  reason: string;
}

export function reinforce(input: ReinforceInput): ReinforceResult {
  const out: Threat[] = [];
  const log: ReinforceLogEntry[] = [];

  for (const t of input.threats) {
    const attackBefore = t.attack;

    // Staged (issue #12): the GM has placed this Threat but not brought it into play. It
    // sits out reinforcement entirely — no escalation, no restore — until it's activated.
    if (t.active === false) {
      out.push({ ...t });
      log.push({ threatId: t.id, name: t.name, attackBefore, attackAfter: t.attack, reason: "staged — not yet in play" });
      continue;
    }

    const reducedToZero = input.reducedToZeroThisRound.has(t.id) || t.rating <= 0;

    // Reduced to 0 (or already there): restore (1d6 + half-Attack) or remove.
    if (reducedToZero) {
      if (t.restoresAtZero) {
        const restoreRoll = input.roller.roll(1)[0] as number;
        out.push({ ...t, rating: t.rating + restoreRoll, attack: Math.floor(t.startingAttack / 2) });
        log.push({
          threatId: t.id,
          name: t.name,
          restoreRoll,
          attackBefore,
          attackAfter: Math.floor(t.startingAttack / 2),
          reason: `defeated this round → +${restoreRoll} rating, Attack reset to floor(${t.startingAttack}/2)`,
        });
      } else {
        log.push({
          threatId: t.id,
          name: t.name,
          removed: true,
          attackBefore,
          attackAfter: 0,
          reason: "defeated → removed permanently (does not restore at 0)",
        });
      }
      continue;
    }

    // Still in play. Solo enemies (reinforces:false) don't escalate.
    if (!t.reinforces) {
      out.push({ ...t });
      log.push({ threatId: t.id, name: t.name, attackBefore, attackAfter: t.attack, reason: "Solo — does not reinforce" });
      continue;
    }

    // Rule 2: still in play → +1. Rule 3: +1 more if zero successes against it.
    let attackAfter = t.attack + 1;
    let reason = "still in play → Attack +1";
    if (input.zeroSuccessThisRound.has(t.id)) {
      attackAfter += 1;
      reason += "; zero successes against it → +1";
    }
    out.push({ ...t, attack: attackAfter });
    log.push({ threatId: t.id, name: t.name, attackBefore, attackAfter, reason });
  }

  return { threats: out, log };
}
