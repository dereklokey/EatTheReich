# Rulebook reconciliation notes

The data in `src/data/` and the engine in `src/engine/` were transcribed from and
verified against the printed rulebook (`reference/…pdf`, gitignored), which the
project owner designated the **ultimate source of truth** for rules and characters.

This file records where the book and `RULES.md` (the engineering contract) **differ**,
so the contract can be reconciled deliberately rather than silently. The code follows
the **book** in each case.

## Discrepancies between RULES.md and the rulebook

> **Status: reconciled.** `RULES.md` §7, §8, and §10 were updated to match the
> rulebook on all four points below. Kept here as a record of *why* the contract
> reads the way it does.

1. **Nicole's Scavenger — trigger.** RULES.md §10/§7 calls Scavenger "a
   condition-trigger restore, **not crit**." The rulebook sheet (p16) prints it as
   `SPECIAL: Roll a D6…`, and p33 states "Specials can only be activated when a
   critical is allocated to them." → Scavenger **is** crit-activated. Encoded as
   `trigger: { type: "crit" }`. **RULES.md §7 and §10 should be corrected.**

2. **Stahlsoldat reinforcement.** RULES.md §8 says Übermenschen simply "do not
   reinforce." The rulebook (p52) gives Stahlsoldat a **hybrid**: "It uses the
   reinforcement rules as normal, but is defeated when it is reduced to 0 Threat."
   So it escalates Attack each round like a standard threat, yet dies at 0. Modelled
   with two flags: `reinforces: true`, `restoresAtZero: false`. **RULES.md §8 should
   note this exception** (and the new two-flag model).

3. **Cosgrave's soul jar — "+4" vs "+++".** RULES.md §10 says the soul jar grants
   "+4". The character sheet (p18) prints `(+++any)` = 3 bonus dice; the prose (p31)
   says it "can add four bonus dice." These reconcile as: +1 (use die) + 3 (`+++`
   bonus) = 4 dice added total. Encoded as the sheet: `bonus.plus = 3`, `uses = 1`.
   Not a true conflict, but worth noting.

4. **Sapper / Back-Pocket Hex / Deadeye Shot — all crit SPECIALs.** RULES.md §10
   describes some of these as flat effects. Per the sheets they are `SPECIAL:` =
   crit-activated, some with a narration condition (Deadeye "when you use a ranged
   weapon"; Sapper "when you use explosives"). Encoded as crit triggers with `tag`
   conditions.

## Engine rules confirmed against the rulebook (no change needed)

- GM pool = `max(Attack of engaged) + (threats-in-play − 1)`; 0 if none engaged
  (p37, golden test A/B). ✓
- Discard ≤3; 4–5 success, 6 = crit (2 units / SPECIAL); GM dice have no crit (p31–32). ✓
- Defend is the only way to cancel GM dice; injury check 0 / 1–2 / 3+ → none / Injury /
  Downed (p33). Death at all 6 boxes → Last Stand 8d6 (p36). ✓
- Reinforcements: reduced-to-0 → +1d6 rating & half-Attack; others +1; +1 for zero
  successes (p38). ✓
- Challenge: per vampire, per turn (p38). ✓
- Flashback: ≤2 successes, once/session, +2 dice & full reroll (p41). ✓

## Special enemy rules captured as data, NOT yet wired into the engine

These live on `Threat.rules` (see `src/data/threats.ts` legend) and need engine hooks
when their surfaces are built:

- **Painless** (Einherjar): each GM Attack die showing 1 raises its Challenge by 1
  for that action (wired, issue #19 — at roll-results the server counts the Reich pool's 1s and
  fires `ENEMY_CHALLENGE_RAISED` per in-play Einherjar; the raise rides on the turn as
  `challengeBump` and inflates the allocation soak, resetting next turn).
- **Bloodless** (Einherjar): no Feed allocation while engaged *only* with it
  (wired, issue #20 — `feedBlockedByBloodless()` is true when every in-play Threat is
  'bloodless' [issue #8 board model: no per-PC engagement]; the allocation tray greys the
  Feed target with the reason. Suggest-don't-enforce §0: Blood can still be set on the sheet,
  and any non-bloodless Threat in play reopens Feed).
- **Anathema** (Vampirjäger Cadre): GM Attack dice score **2** successes each on a 6
  (wired, issue #21 — `gmSuccessTally(dice, anathemaInPlay)` folds +1 per 6 into the GM
  success count at resolve_discard while a Cadre is in play [issue #8 board model: pool-wide],
  before the player passives that cancel successes; `DICE_DISCARDED.anathemaBonus` feeds the
  after-action report, and the roll-results / allocation readouts flag "⚠ Anathema").
- **Rapid Deployment** (Paratrooper Squad): when its Attack +1 via Reinforcement,
  also +2 rating (wired, issue #22 — applies to BOTH "+1 Attack" Reinforcement bumps:
  end-of-round rule 2 in `reinforce()` [`ratingDelta` in the breakdown] and the
  action-conclusion whiff in `gmWhiffEvent`/`GM_WHIFF.rating`. Rule 1's defeated-reset
  sets Attack to floor(start/2) — not an "add" — so it doesn't trigger).
- **Crash and Burn** (Motorcycle Squad): grants every engaged vampire a SPECIAL that
  deals 3 damage to it.
- **Aura of Misfortune** (Rust-Witch): players discard 1–4 (modelled as
  `discardThreshold: 4`, which the engine already supports).
- **Rust Curse** (Rust-Witch): end of round, one random item of a chosen PC degrades
  (wired, issue #13 — GM names the PC, server rolls the item, `EQUIPMENT_DEGRADED` zeroes
  its uses).
- **Rending Claws** (Werhund): an Injury from it marks **all** boxes in the rolled
  category (Downed-like severity).
- **Corrosive Fluids / Feed on Fear** (Chuck/Nicole advances): "when you mark an
  Injury…" / "when you reduce a Threat to 0…" — passive triggers needing hooks.

## Still pending (not in the rulebook text, or deferred)

- Per-item starting **use counts** were read from the sheet pips and follow the
  pattern + → 3, ++ → 2, +++/++++ → 1 (verified on all six sheets). Spot-check if a
  physical copy is handy.
