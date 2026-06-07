import type { Threat } from "../domain/types.js";
import type { DiceRoller } from "../domain/dice.js";

/**
 * REINFORCEMENTS — end of round (RULES §8). Standard rules:
 *  1. Any Threat reduced to 0 THIS round: restore rating by 1d6; set Attack to
 *     floor(startingAttack / 2). (It does NOT also get the +1 from rule 2.)
 *  2. Every Threat still in play (rating > 0, and NOT one restored by rule 1):
 *     Attack +1.
 *
 * The third rulebook clause — a GM Attack roll with zero successes bumps the lead
 * Threat's Attack by 1 — is NOT handled here: it fires immediately at the conclusion of
 * the action that whiffed (rulebook p38: "once the player has resolved their action"),
 * not at end of round. See `whiffAnchor` (gmPool.ts) + the handler's commit/resolve_injury.
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
  /** Rating gained from a special on the +1 Attack escalation (Paratrooper 'Rapid Deployment'
   *  adds +2). Present only when an escalation bumps the rating beyond the normal restore. */
  ratingDelta?: number;
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

    // Rule 2: still in play → Attack +1 (nazi forces closing in). The zero-success bump
    // is applied earlier, at the conclusion of the whiffing action (see whiffAnchor).
    const attackAfter = t.attack + 1;
    // Paratrooper 'Rapid Deployment' (#22, rulebook p61): Attack added via Reinforcement also
    // adds +2 Threat rating. Rule 1's defeated-reset sets Attack to floor(start/2) — not an
    // "add" — so it doesn't trigger; the whiff's +1 (rule 3) is handled in gmWhiffEvent.
    const rapid = (t.rules ?? []).includes("rapid-deployment");
    const ratingAfter = rapid ? t.rating + 2 : t.rating;
    out.push({ ...t, attack: attackAfter, rating: ratingAfter });
    log.push({
      threatId: t.id,
      name: t.name,
      attackBefore,
      attackAfter,
      ...(rapid ? { ratingDelta: 2 } : {}),
      reason: rapid ? "still in play → Attack +1, Rapid Deployment +2 rating" : "still in play → Attack +1",
    });
  }

  return { threats: out, log };
}
