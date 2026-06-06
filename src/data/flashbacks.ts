/**
 * Flashback tables (RULES §9, rulebook p41). Once per session, when a player rolls
 * ≤2 successes, they may trigger a flashback: roll/pick a context and a question,
 * narrate, then add 2 dice and reroll the whole pool (the second result stands).
 * `[character]` = a present PC, randomly chosen or picked.
 */

/** d6 → context. (Matching another player's roll = same mission.) */
export const FLASHBACK_CONTEXTS: Record<number, string> = {
  1: "On board a plummeting aeroplane",
  2: "Rescuing P.O.W.s in a thunderstorm",
  3: "Assassinating a nazi general at the opera",
  4: "Extracting a spy from behind enemy lines",
  5: "Stealing a cypher machine from a submarine",
  6: "Sabotaging a field gun with improvised explosives",
};

/** d6 → question about a present `[character]`. */
export const FLASHBACK_QUESTIONS: Record<number, string> = {
  1: "You saved [character] from certain death. What nearly killed them?",
  2: "You recruited [character] to F.A.N.G. What did it take to get them on board?",
  3: "You owe your life to [character]. How did they save it?",
  4: "[character] taught you a few tricks. What was the most important lesson?",
  5: "You won't let [character] see you fail like this. What do you respect most about them?",
  6: "You won't let [character] see you fail like this. What do they most respect about you?",
};

/** Trigger condition (RULES §9). */
export const FLASHBACK_SUCCESS_THRESHOLD = 2; // ≤ this many successes
export const FLASHBACK_BONUS_DICE = 2;
