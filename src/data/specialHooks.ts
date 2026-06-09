/**
 * Special-rules framework — the catalog of every mechanic that steps OUTSIDE the normal
 * turn flow, mapped to (a) *where* in the flow it fires (its hook point) and (b) *how* the
 * table resolves it (auto / acknowledge / select / message, by system / GM / player).
 *
 * This module is deliberately the framework, not the implementations. Each `planned` entry
 * has a tracking GitHub issue; the per-special logic (and the final decision on exactly how
 * each one applies) lands in that issue's PR. The `implemented` entries document the
 * specials the engine already handles, so the catalog is a complete map of the exception
 * surface — and the tests assert nothing slips through uncatalogued.
 *
 * Audit: issue #14. Companion docs: `SPECIAL_HOOKS.md` (the narrative map + code sites),
 * `RULEBOOK_NOTES.md` (which rules are data-only vs wired). Catalog conventions mirror the
 * other `src/data/*` catalogs (threats.ts, characters.ts): pure data + types, unit-tested.
 */

/**
 * Lifecycle moments where a special circumstance can fire — the "hook locations" in the
 * resolution flow (RULES §4 turn machine, plus the round boundary). Ordered as they occur.
 */
export type HookPoint =
  /** Turn declared (stat / tags / targets chosen), before any pool is built. */
  | "DECLARE"
  /** Player & GM pools assembled (RULES §4 BUILD_*_POOL). */
  | "BUILD_POOL"
  /** Dice rolled + successes counted, before/at discard — the passive window (RULES §4
   *  PRE_DISCARD_HOOKS / DISCARD). Effects here are typically reported on the roll-results
   *  / allocation screen. */
  | "ROLL_RESULTS"
  /** The allocation screen (RULES §4 ALLOCATE): crit SPECIALs, Feed gating, target picks. */
  | "ALLOCATE"
  /** The injury-check window (RULES §4 INJURY_CHECK): the reveal + reactive-gear beat. */
  | "INJURY"
  /** The action concluded (RULES §4 POST_ALLOCATE / DONE): reduce-to-0 triggers, whiff. */
  | "TURN_END"
  /** End of round / reinforcements (RULES §8). */
  | "ROUND_END";

export const HOOK_POINTS: readonly HookPoint[] = [
  "DECLARE",
  "BUILD_POOL",
  "ROLL_RESULTS",
  "ALLOCATE",
  "INJURY",
  "TURN_END",
  "ROUND_END",
] as const;

/** Where each hook point sits in the flow + the code site that owns it (for UI + future wiring). */
export const HOOK_POINT_INFO: Record<HookPoint, { order: number; when: string; site: string }> = {
  DECLARE: { order: 0, when: "turn declared, before pools", site: "handler.ts `start_turn`; reducer TURN_STARTED" },
  BUILD_POOL: { order: 1, when: "player & GM pools assembled", site: "engine/playerPool.ts, engine/gmPool.ts; handler.ts `roll`/`roll_gm`" },
  ROLL_RESULTS: { order: 2, when: "rolled + successes counted, before/at discard", site: "engine/passives.ts, engine/dice.ts; handler.ts `resolve_discard`" },
  ALLOCATE: { order: 3, when: "the allocation screen", site: "engine/allocate.ts, engine/specials.ts; handler.ts `allocate`" },
  INJURY: { order: 4, when: "injury-check reveal + reaction window", site: "engine/injury.ts; handler.ts `roll_injury`/`resolve_injury`" },
  TURN_END: { order: 5, when: "action concluded", site: "handler.ts `commit`/`resolve_injury`; reducer ALLOCATION_COMMITTED" },
  ROUND_END: { order: 6, when: "end of round / reinforcements", site: "engine/reinforcements.ts; handler.ts `end_round`" },
};

/** How a circumstance resolves at the table. */
export type Resolution =
  /** Engine applies an editable, logged default — no table input (the `grantsBlood` pattern). */
  | "auto"
  /** A human taps to apply/confirm; no data entry. */
  | "acknowledge"
  /** A human picks a target/value before it applies. */
  | "select"
  /** Informational only — surfaced to the table, nothing to apply. */
  | "message";

/** Who drives the resolution. */
export type HookActor = "system" | "gm" | "player";

/** What a `select` resolution asks the actor to choose. */
export type TargetKind =
  | "none"
  | "threat"
  | "objective"
  | "objective_or_threat"
  | "gm_dice"
  | "injury_box"
  | "equipment"
  | "player"
  | "blood";

export type HookStatus = "implemented" | "planned";

/** Where a special rule originates. */
export type HookSource =
  | { kind: "enemy"; threat: string; tag: string }
  | { kind: "ability" | "advance"; character: string; powerIds: string[] }
  | { kind: "item"; character: string; itemIds: string[] }
  | { kind: "objective" }
  | { kind: "injury" };

export interface SpecialHook {
  /** Stable key, e.g. "enemy.painless", "ability.apex-predator". */
  id: string;
  name: string;
  source: HookSource;
  /** One-line rule summary (rulebook). */
  rule: string;
  /** When in the flow it fires. */
  hook: HookPoint;
  /** Plain-language description of what fires it. */
  trigger: string;
  /** Provisional resolution mode — the final call is made when the issue is worked. */
  resolution: Resolution;
  actor: HookActor;
  /** For `select` resolutions: what gets chosen. */
  target?: TargetKind;
  status: HookStatus;
  /** Tracking issue for `planned` work. Omitted for `implemented`. */
  issue?: number;
}

/**
 * The catalog. `implemented` entries document what the engine already does; `planned`
 * entries point at the tracking issue that will build them. Provisional `hook`/`resolution`
 * are best-guess starting points, NOT commitments — each issue decides the final shape.
 */
export const SPECIAL_HOOKS: SpecialHook[] = [
  // ── Enemy special rules — already wired ────────────────────────────────────
  {
    id: "enemy.solo",
    name: "Solo / no reinforcements",
    source: { kind: "enemy", threat: "Sniper Team, Tank, Armoured Car, Vampirjäger, Übermenschen…", tag: "solo" },
    rule: "Does not use the Reinforcement rules; removed permanently at rating 0.",
    hook: "ROUND_END",
    trigger: "end of round",
    resolution: "auto",
    actor: "system",
    status: "implemented",
  },
  {
    id: "enemy.powering-up",
    name: "Powering up",
    source: { kind: "enemy", threat: "Stahlsoldat", tag: "powering-up" },
    rule: "Reinforces (escalates Attack) like a normal threat, yet is defeated at rating 0.",
    hook: "ROUND_END",
    trigger: "end of round",
    resolution: "auto",
    actor: "system",
    status: "implemented",
  },
  {
    id: "enemy.aura-of-misfortune",
    name: "Aura of Misfortune",
    source: { kind: "enemy", threat: "Rust-Witch", tag: "aura-of-misfortune" },
    rule: "While it is in play, players discard 1–4 instead of 1–3 (discardThreshold 4).",
    hook: "ROLL_RESULTS",
    trigger: "discard step while the Rust-Witch is in play",
    resolution: "auto",
    actor: "system",
    status: "implemented",
  },

  // ── Enemy special rules — planned ──────────────────────────────────────────
  {
    id: "enemy.rust-curse",
    name: "Rust Curse",
    source: { kind: "enemy", threat: "Rust-Witch", tag: "rust-curse" },
    rule: "End of round: one random equipment item of a GM-chosen PC degrades into uselessness.",
    hook: "ROUND_END",
    trigger: "end of round while the Rust-Witch is in play",
    resolution: "select",
    actor: "gm",
    target: "player",
    status: "implemented",
  },
  {
    id: "enemy.painless",
    name: "Painless",
    source: { kind: "enemy", threat: "Einherjar", tag: "painless" },
    rule: "Each GM Attack die showing 1 raises this enemy's Challenge by 1 for this action.",
    hook: "ROLL_RESULTS",
    trigger: "GM Attack dice contain 1s",
    resolution: "auto",
    actor: "system",
    target: "none",
    status: "implemented",
  },
  {
    id: "enemy.bloodless",
    name: "Bloodless",
    source: { kind: "enemy", threat: "Einherjar", tag: "bloodless" },
    rule: "PCs cannot spend dice to regain Blood while engaged only with the Einherjar.",
    hook: "ALLOCATE",
    trigger: "the allocation screen while every in-play Threat is 'bloodless' (issue #8 board model)",
    resolution: "message",
    actor: "system",
    status: "implemented",
  },
  {
    id: "enemy.anathema",
    name: "Anathema",
    source: { kind: "enemy", threat: "Vampirjäger Cadre", tag: "anathema" },
    rule: "GM Attack dice score 2 successes each on a 6.",
    hook: "ROLL_RESULTS",
    trigger: "GM Attack dice contain 6s while a Vampirjäger Cadre is in play (issue #8 board model)",
    resolution: "auto",
    actor: "system",
    status: "implemented",
  },
  {
    id: "enemy.rapid-deployment",
    name: "Rapid Deployment",
    source: { kind: "enemy", threat: "Paratrooper Squad", tag: "rapid-deployment" },
    rule: "When its Attack +1 via Reinforcement, its rating also +2.",
    hook: "ROUND_END",
    trigger: "a Reinforcement +1 Attack (end-of-round rule 2, or the action-conclusion whiff)",
    resolution: "auto",
    actor: "system",
    status: "implemented",
  },
  {
    id: "enemy.crash-and-burn",
    name: "Crash & Burn",
    source: { kind: "enemy", threat: "Motorcycle Squad", tag: "crash-and-burn" },
    rule: "Grants every engaged vampire a SPECIAL that deals 3 damage to it.",
    hook: "ALLOCATE",
    trigger: "a crit is allocated to the board-granted SPECIAL (squad in play, issue #8 model)",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "implemented",
  },
  {
    id: "enemy.rending-claws",
    name: "Rending Claws",
    source: { kind: "enemy", threat: "Werhund", tag: "rending-claws" },
    rule: "A normal (non-Downed) Injury from it marks ALL boxes in the rolled category.",
    hook: "INJURY",
    trigger: "an Injury attributed to the Werhund is marked",
    resolution: "acknowledge",
    actor: "gm",
    status: "implemented",
  },
  {
    id: "enemy.unlowerable-challenge",
    name: "Unlowerable Challenge",
    source: { kind: "enemy", threat: "Werhund", tag: "unlowerable-challenge" },
    rule: "This enemy's Challenge cannot be lowered — every reduction routes through engine lowerChallenge(), which returns it unchanged (isChallengeUnlowerable gate); the board flags the lock.",
    hook: "ALLOCATE",
    trigger: "a Challenge-reduction effect targets it",
    resolution: "message",
    actor: "system",
    status: "implemented",
  },

  // ── Character SPECIALs (crit-allocated) — already wired ─────────────────────
  {
    id: "ability.ravenous",
    name: "Ravenous",
    source: { kind: "ability", character: "Flint", powerIds: ["flint-ravenous"] },
    rule: "In melee: crit → gain 3 Blood (self-buff, applied via grantsBlood).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL (melee tag)",
    resolution: "auto",
    actor: "player",
    target: "blood",
    status: "implemented",
  },

  // ── Character SPECIALs (crit-allocated) — planned ──────────────────────────
  {
    id: "ability.minus-attack",
    name: "Deadeye Shot / Back-Pocket Hex (−1 Threat Attack)",
    source: { kind: "ability", character: "Iryna, Cosgrave", powerIds: ["iryna-deadeye-shot", "cosgrave-back-pocket-hex"] },
    rule: "Crit on the SPECIAL (with a chosen Threat) → −1 to that Threat's Attack, via the Power.reduceThreatAttack descriptor; the handler emits a logged THREAT_ATTACK_REDUCED default (Deadeye requires a ranged weapon).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "implemented",
  },
  {
    id: "ability.apex-predator",
    name: "Apex Predator",
    source: { kind: "ability", character: "Astrid", powerIds: ["astrid-apex-predator"] },
    rule: "Crit on the SPECIAL (with a chosen Threat) → −3 to that Threat's rating, via the Power.reduceThreatRating descriptor carried as the allocation's ratingDamage; bypasses Challenge, rating 0 → Attack 0 (the Crash & Burn engine path).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "implemented",
  },
  {
    id: "ability.unnatural-endurance",
    name: "Unnatural Endurance",
    source: { kind: "ability", character: "Astrid", powerIds: ["astrid-unnatural-endurance"] },
    rule: "Crit on the SPECIAL → −3 this turn's surviving GM Attack dice (a targetless 'big Defend'), via the Power.reduceGmDice descriptor carried as the allocation's gmDiceReduction; folds through the engine's gmDiceRemaining (clamped ≥0).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "acknowledge",
    actor: "player",
    target: "gm_dice",
    status: "implemented",
  },
  {
    id: "ability.sapper",
    name: "Sapper",
    source: { kind: "ability", character: "Nicole", powerIds: ["nicole-sapper"] },
    rule: "Using explosives: crit (with a chosen Objective or Threat) → −1 to that target's Challenge, via the Power.reduceChallenge descriptor; the handler routes the drop through engine lowerChallenge (so the Werhund's 'Unlowerable Challenge' is honoured) and emits a logged CHALLENGE_REDUCED default.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL (explosives tag)",
    resolution: "select",
    actor: "player",
    target: "objective_or_threat",
    status: "implemented",
  },
  {
    id: "advance.elbow-grease",
    name: "Elbow Grease",
    source: { kind: "advance", character: "Chuck", powerIds: ["chuck-elbow-grease"] },
    rule: "Solo FIX Objective: crit (with the chosen Objective) → −4 to that Objective's rating, via the Power.reduceObjectiveRating descriptor carried as the allocation's ratingDamage; folds through the same ENGINE path as Apex Predator (#27), bypassing Challenge, rating clamped at 0. Gating (solo FIX Objective) is the pure availableCritSpecials filter (golden test E).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL on a solo FIX Objective",
    resolution: "select",
    actor: "player",
    target: "objective",
    status: "implemented",
  },
  {
    id: "advance.nightmare-regeneration",
    name: "Nightmare Regeneration",
    source: { kind: "advance", character: "Astrid", powerIds: ["astrid-nightmare-regeneration"] },
    rule: "Crit (with a chosen injury category) → clear the highest marked box in that category, via the Power.clearsInjury descriptor carried as the allocation's injuryCategory. The handler resolves the box from the live track (server-authoritative; an unmarked category emits nothing) and emits a logged, GM-editable HEALED.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "select",
    actor: "player",
    target: "injury_box",
    status: "implemented",
  },
  {
    id: "ability.scavenger",
    name: "Scavenger",
    source: { kind: "ability", character: "Nicole", powerIds: ["nicole-scavenger"] },
    rule: "Crit on the SPECIAL → the player throws a salvage d6 in the arena (its own `scavenge` beat, not the lock-in fold); the SERVER rolls it (anti-fudge) and the face maps to the numbered weapon carrying that scavengerSlot, restoring 1 use via SCAVENGER_ROLLED. The crit still commits as a normal `special` allocation.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL, then the salvage die is thrown",
    resolution: "acknowledge",
    actor: "player",
    target: "equipment",
    status: "implemented",
  },

  // ── Character passives (triggered) — already wired ─────────────────────────
  {
    id: "ability.corpse-eater",
    name: "Corpse Eater",
    source: { kind: "ability", character: "Chuck", powerIds: ["corpse-eater"] },
    rule: "After the roll, before discard: +1 Blood if any 1 was rolled.",
    hook: "ROLL_RESULTS",
    trigger: "any 1 in the player roll",
    resolution: "auto",
    actor: "system",
    target: "blood",
    status: "implemented",
  },
  {
    id: "advance.dead-mans-luck",
    name: "Dead Man's Luck",
    source: { kind: "advance", character: "Cosgrave", powerIds: ["dead-mans-luck"] },
    rule: "After the roll, before discard: −1 GM success per 1 the player rolled.",
    hook: "ROLL_RESULTS",
    trigger: "1s in the player roll",
    resolution: "auto",
    actor: "system",
    target: "gm_dice",
    status: "implemented",
  },
  {
    id: "advance.bone-armour",
    name: "Bone Armour",
    source: { kind: "advance", character: "Flint", powerIds: ["bone-armour"] },
    rule: "After the roll, before discard: −1 GM success per 1 the player rolled.",
    hook: "ROLL_RESULTS",
    trigger: "1s in the player roll",
    resolution: "auto",
    actor: "system",
    target: "gm_dice",
    status: "implemented",
  },

  // ── Character passives (triggered) — planned ───────────────────────────────
  {
    id: "advance.feed-on-fear",
    name: "Feed on Fear",
    source: { kind: "advance", character: "Nicole", powerIds: ["nicole-feed-on-fear"] },
    rule: "When you reduce a Threat's rating to 0, gain 3 Blood — via the Power.bloodOnThreatKill descriptor. A triggered passive (not crit-allocated): the handler pays it at `commit` (TURN_END) for every Threat this turn's allocations brought to rating 0, as a logged, GM-editable BLOOD_CHANGED. Fires whether or not a GM die reaches the injury check; per-Threat, once each.",
    hook: "TURN_END",
    trigger: "the action concludes with a Threat the actor reduced to rating 0",
    resolution: "auto",
    actor: "system",
    target: "blood",
    status: "implemented",
  },
  {
    id: "advance.corrosive-fluids",
    name: "Corrosive Fluids",
    source: { kind: "advance", character: "Chuck", powerIds: ["chuck-corrosive-fluids"] },
    rule: "When you mark an Injury, reduce a Threat you're engaged with by 2 — via the Power.reduceThreatRatingOnInjury descriptor. A triggered passive (not crit-allocated): the handler fires it from the `resolve_injury` path the moment an INJURY_MARKED lands, against the in-play Threat the player named (`resolve_injury.corrosiveTargetId`), as a logged, GM-editable THREAT_RATING_REDUCED. Direct damage like Apex Predator — bypasses Challenge, rating 0 → Attack 0. A locked advance / shrugged-off wound corrodes nothing.",
    hook: "INJURY",
    trigger: "an Injury is marked on Chuck",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "implemented",
  },

  // ── No-die actives that mutate the board from the sheet — already wired ─────
  {
    id: "active.challenge-reduction",
    name: "Tethered Phantom / Hellish Screech (−1 Challenge)",
    source: { kind: "advance", character: "Astrid, Flint", powerIds: ["astrid-tethered-phantom", "flint-hellish-screech"] },
    rule: "No-die actives used from the sheet (a `use_power` intent, not folded into the dice pool): spend Blood, drop a chosen target's Challenge by 1 via the Power.sheetChallengeReduction descriptor, routed through engine lowerChallenge (so the Werhund's 'Unlowerable Challenge' #25 holds) as a logged CHALLENGE_REDUCED. Tethered Phantom hits an Objective OR Threat and expires at end of round (banked as the target's tempChallengeReduction, restored by the ROUND_ENDED reducer); Hellish Screech hits a Threat, permanently.",
    hook: "DECLARE",
    trigger: "the power is used from the sheet",
    resolution: "select",
    actor: "player",
    target: "objective_or_threat",
    status: "implemented",
  },

  // ── Cross-turn stances (pending-buff state) — implemented ──────────────────
  {
    id: "stance.cross-turn",
    name: "Mantle / Enervation / Hell's Ravenous Fire",
    source: { kind: "ability", character: "Iryna", powerIds: ["iryna-mantle", "iryna-enervation", "iryna-hells-fire"] },
    rule: "No-die actives that buff a FUTURE action, armed from the sheet via the `set_stance` intent (Power.setsStance → an ActiveStance parked on the character). Hell's Ravenous Fire: the next turn ignores Threat Challenge (the engine `eliminate` soak treats it as 0; consumed at TURN_STARTED). Enervation of the Soul: the next roll grants a SPECIAL that inflicts 4 to an Übermensch, folded through the same `ratingDamage` engine path as Apex Predator (the tray offers it per in-play Übermensch). Mantle of the Fell Beast: BRAWL/TERRIFY → 4, all else → 1, items locked — read derived (activeMantle) against the bound Objective's rating, so completing it by any path ends the stance.",
    hook: "DECLARE",
    trigger: "the stance is armed, then consumed on the affected turn (Mantle persists until its Objective completes)",
    resolution: "auto",
    actor: "player",
    status: "implemented",
  },

  // ── Objective rewards — wired ──────────────────────────────────────────────
  {
    id: "objective.secondary-rewards",
    name: "Secondary-objective reward menu",
    source: { kind: "objective" },
    rule: "On completion, apply the chosen reward: −D6 Objective · −D6 Threat · +D6 Blood · −2 Attack · −1 Challenge · gain equipment (#37; equipment via the #4 reward-gear path).",
    hook: "TURN_END",
    trigger: "a Secondary Objective is completed",
    resolution: "select",
    actor: "gm",
    target: "objective_or_threat",
    status: "implemented",
  },
  {
    id: "injury.downed-rescue-objective",
    name: "Downed → rescue Secondary Objective",
    source: { kind: "injury" },
    rule: "A Downed vampire auto-spawns an unrevealed rescue Secondary Objective (rating ~2–4, GM sets); unrescued at scene end → captured (#16).",
    hook: "INJURY",
    trigger: "a Downed outcome resolves",
    resolution: "select",
    actor: "gm",
    target: "objective",
    status: "implemented",
  },

  // ── Reactive economy items — already wired ─────────────────────────────────
  {
    id: "item.cigarettes",
    name: "Cigarettes (reactive Blood)",
    source: { kind: "item", character: "Iryna", itemIds: ["iryna-cigarettes"] },
    rule: "Mark a use → regain 2 Blood (applied automatically wherever used).",
    hook: "ALLOCATE",
    trigger: "the item is used",
    resolution: "auto",
    actor: "player",
    target: "blood",
    status: "implemented",
  },
  {
    id: "item.cowboy-hat",
    name: "Cowboy hat (ignore an Injury)",
    source: { kind: "item", character: "Chuck", itemIds: ["chuck-cowboy-hat"] },
    rule: "Mark to ignore a pending Injury or being Downed; the hat is destroyed.",
    hook: "INJURY",
    trigger: "a pending Injury/Downed, before it is marked",
    resolution: "acknowledge",
    actor: "player",
    status: "implemented",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** All hooks that fire at a given point in the flow, in catalog order. */
export const hooksAt = (point: HookPoint): SpecialHook[] =>
  SPECIAL_HOOKS.filter((h) => h.hook === point);

/** Hooks still awaiting implementation (each carries its tracking `issue`). */
export const plannedHooks = (): SpecialHook[] =>
  SPECIAL_HOOKS.filter((h) => h.status === "planned");

/** Hooks the engine already handles. */
export const implementedHooks = (): SpecialHook[] =>
  SPECIAL_HOOKS.filter((h) => h.status === "implemented");

/** Look up a catalog entry by its stable id. */
export const hookById = (id: string): SpecialHook | undefined =>
  SPECIAL_HOOKS.find((h) => h.id === id);

export const SPECIAL_HOOKS_BY_ID: Record<string, SpecialHook> = Object.fromEntries(
  SPECIAL_HOOKS.map((h) => [h.id, h]),
);
