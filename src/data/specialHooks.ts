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
    trigger: "a crit is allocated to the board-granted SPECIAL",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "planned",
    issue: 23,
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
    status: "planned",
    issue: 24,
  },
  {
    id: "enemy.unlowerable-challenge",
    name: "Unlowerable Challenge",
    source: { kind: "enemy", threat: "Werhund", tag: "unlowerable-challenge" },
    rule: "This enemy's Challenge cannot be lowered (the unlowerableChallenge field is unused today).",
    hook: "ALLOCATE",
    trigger: "a Challenge-reduction effect targets it",
    resolution: "message",
    actor: "system",
    status: "planned",
    issue: 25,
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
    rule: "Crit → reduce a Threat's Attack by 1 (Deadeye requires a ranged weapon).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "planned",
    issue: 26,
  },
  {
    id: "ability.apex-predator",
    name: "Apex Predator",
    source: { kind: "ability", character: "Astrid", powerIds: ["astrid-apex-predator"] },
    rule: "Crit → reduce a Threat's rating by 3.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "planned",
    issue: 27,
  },
  {
    id: "ability.unnatural-endurance",
    name: "Unnatural Endurance",
    source: { kind: "ability", character: "Astrid", powerIds: ["astrid-unnatural-endurance"] },
    rule: "Crit → reduce the GM's Attack dice by 3 this turn.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "acknowledge",
    actor: "player",
    target: "gm_dice",
    status: "planned",
    issue: 28,
  },
  {
    id: "ability.sapper",
    name: "Sapper",
    source: { kind: "ability", character: "Nicole", powerIds: ["nicole-sapper"] },
    rule: "Using explosives: crit → reduce an Objective or Threat's Challenge by 1.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL (explosives tag)",
    resolution: "select",
    actor: "player",
    target: "objective_or_threat",
    status: "planned",
    issue: 29,
  },
  {
    id: "advance.elbow-grease",
    name: "Elbow Grease",
    source: { kind: "advance", character: "Chuck", powerIds: ["chuck-elbow-grease"] },
    rule: "Solo FIX Objective: crit → reduce that Objective's rating by 4 (gating already wired).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL on a solo FIX Objective",
    resolution: "auto",
    actor: "player",
    target: "objective",
    status: "planned",
    issue: 30,
  },
  {
    id: "advance.nightmare-regeneration",
    name: "Nightmare Regeneration",
    source: { kind: "advance", character: "Astrid", powerIds: ["astrid-nightmare-regeneration"] },
    rule: "Crit → clear a marked Injury.",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "select",
    actor: "player",
    target: "injury_box",
    status: "planned",
    issue: 31,
  },
  {
    id: "ability.scavenger",
    name: "Scavenger",
    source: { kind: "ability", character: "Nicole", powerIds: ["nicole-scavenger"] },
    rule: "Crit → roll a D6, restore 1 use of the matching numbered weapon (scavengerSlot).",
    hook: "ALLOCATE",
    trigger: "crit allocated to the SPECIAL",
    resolution: "auto",
    actor: "system",
    target: "equipment",
    status: "planned",
    issue: 32,
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
    rule: "When you reduce a Threat's rating to 0, gain 3 Blood.",
    hook: "TURN_END",
    trigger: "an allocation brings a Threat to rating 0",
    resolution: "auto",
    actor: "system",
    target: "blood",
    status: "planned",
    issue: 33,
  },
  {
    id: "advance.corrosive-fluids",
    name: "Corrosive Fluids",
    source: { kind: "advance", character: "Chuck", powerIds: ["chuck-corrosive-fluids"] },
    rule: "When you mark an Injury, reduce a Threat you're engaged with by 2.",
    hook: "INJURY",
    trigger: "an Injury is marked on Chuck",
    resolution: "select",
    actor: "player",
    target: "threat",
    status: "planned",
    issue: 34,
  },

  // ── No-die actives that mutate the board from the sheet — planned ──────────
  {
    id: "active.challenge-reduction",
    name: "Tethered Phantom / Hellish Screech (−1 Challenge)",
    source: { kind: "advance", character: "Astrid, Flint", powerIds: ["astrid-tethered-phantom", "flint-hellish-screech"] },
    rule: "No-die actives: reduce a target's Challenge by 1 (Tethered Phantom: until end of round).",
    hook: "DECLARE",
    trigger: "the power is used from the sheet",
    resolution: "select",
    actor: "player",
    target: "objective_or_threat",
    status: "planned",
    issue: 35,
  },

  // ── Cross-turn stances (pending-buff state) — planned ──────────────────────
  {
    id: "stance.cross-turn",
    name: "Mantle / Enervation / Hell's Ravenous Fire",
    source: { kind: "ability", character: "Iryna", powerIds: ["iryna-mantle", "iryna-enervation", "iryna-hells-fire"] },
    rule: "Buff a FUTURE action/turn: ignore Challenge next action · grant a 4-dmg SPECIAL next roll · stat transform until the Objective completes.",
    hook: "DECLARE",
    trigger: "the stance is set, then consumed on the affected turn",
    resolution: "auto",
    actor: "player",
    status: "planned",
    issue: 36,
  },

  // ── Objective rewards — planned ────────────────────────────────────────────
  {
    id: "objective.secondary-rewards",
    name: "Secondary-objective reward menu",
    source: { kind: "objective" },
    rule: "On completion, apply the chosen reward: −D6 Objective · −D6 Threat · +D6 Blood · −2 Attack · −1 Challenge · gain equipment.",
    hook: "TURN_END",
    trigger: "a Secondary Objective is completed",
    resolution: "select",
    actor: "gm",
    target: "objective_or_threat",
    status: "planned",
    issue: 37,
  },
  {
    id: "injury.downed-rescue-objective",
    name: "Downed → rescue Secondary Objective",
    source: { kind: "injury" },
    rule: "A Downed vampire spawns a rescue Secondary Objective (rating ~2–4, GM sets).",
    hook: "INJURY",
    trigger: "a Downed outcome resolves",
    resolution: "select",
    actor: "gm",
    target: "objective",
    status: "planned",
    issue: 16,
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
