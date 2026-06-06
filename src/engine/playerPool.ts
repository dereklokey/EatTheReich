/**
 * BUILD_PLAYER_POOL (RULES §4). Pool = stat rating, then:
 *  +1 per equipment item used (spends a use)
 *  +1 per ability used (some add no die — caller flags it)
 *  +N bonus dice per satisfied bonus requirement (N = number of `+`)
 *  +1 "Go Out With A Bang" if this is the last use of an item that started with >1
 *
 * The pool is NOT frozen at roll time: more bonus dice may be rolled during
 * ALLOCATE as new narrated details satisfy requirements (RULES §4). Callers add
 * those with `addBonusDice`.
 */
export interface PoolSource {
  /** Human label shown on the die's tag in the resolution theater ("SHOOT", "rifle"). */
  label: string;
  /** Dice this source contributes. */
  dice: number;
}

export interface PoolBuildInput {
  stat: { name: string; rating: number };
  /** Equipment used this action. */
  equipment?: Array<{
    label: string;
    /** +`bonusPlus` bonus dice if its requirement is satisfied (GM-confirmed). */
    bonusPlus?: number;
    bonusSatisfied?: boolean;
    /** Uses remaining BEFORE this action; drives Go Out With A Bang. */
    usesBefore?: number;
  }>;
  /** Abilities used this action (each adds a die unless addsDie === false). */
  abilities?: Array<{
    label: string;
    addsDie?: boolean;
    /** +`bonusPlus` bonus dice if its requirement is satisfied (GM-confirmed). */
    bonusPlus?: number;
    bonusSatisfied?: boolean;
  }>;
}

export interface PoolBuildResult {
  total: number;
  sources: PoolSource[];
}

export function buildPlayerPool(input: PoolBuildInput): PoolBuildResult {
  const sources: PoolSource[] = [];

  // Base: the stat rating (flat 2 if no stat fits — caller passes rating 2).
  sources.push({ label: input.stat.name, dice: input.stat.rating });

  for (const e of input.equipment ?? []) {
    sources.push({ label: e.label, dice: 1 }); // +1 for using the item

    if (e.bonusSatisfied && e.bonusPlus && e.bonusPlus > 0) {
      sources.push({ label: `+${e.label} bonus`, dice: e.bonusPlus });
    }

    // Go Out With A Bang: last use of an item that STARTED with >1 use → +1.
    if (e.usesBefore !== undefined && e.usesBefore === 1) {
      // usesBefore === 1 means this action spends the final use. The ">1 at start"
      // check is the caller's responsibility via item metadata; we treat "this is
      // the last use" as the trigger and document the precondition.
      sources.push({ label: `${e.label} — Go Out With A Bang`, dice: 1 });
    }
  }

  for (const a of input.abilities ?? []) {
    if (a.addsDie !== false) sources.push({ label: a.label, dice: 1 }); // +1 for using it

    if (a.bonusSatisfied && a.bonusPlus && a.bonusPlus > 0) {
      sources.push({ label: `+${a.label} bonus`, dice: a.bonusPlus });
    }
  }

  const total = sources.reduce((sum, s) => sum + s.dice, 0);
  return { total, sources };
}

/** Mid-allocation bonus dice (RULES §4): a newly satisfied requirement adds dice now. */
export function addBonusDice(label: string, plus: number): PoolSource {
  return { label: `+${label}`, dice: plus };
}
