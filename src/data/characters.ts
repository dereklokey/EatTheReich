import type { Stat } from "../domain/types.js";
import type { CharacterSheet } from "../domain/character.js";

/**
 * The six fixed pregens (RULES §10). This file encodes the mechanical HOOKS the
 * engine needs — SPECIAL triggers, passives, ability/equipment shapes.
 *
 * ⚠️ NUMERIC STAT BLOCKS PENDING: RULES.md §10 deliberately does not reproduce the
 * verbatim stat ratings ("Full verbatim stat blocks → typed data files"). Those
 * must be transcribed from the rulebook. Ratings left at 0 below are placeholders
 * and are marked PENDING. The one known value is Iryna's SHOOT 3 (golden test A).
 * Inventing the rest would violate "RULES.md is the source of truth".
 */

const PENDING = 0; // rulebook stat rating not yet transcribed

const zeroStats = (): Record<Stat, number> => ({
  BRAWL: PENDING,
  CON: PENDING,
  FIX: PENDING,
  SEARCH: PENDING,
  SHOOT: PENDING,
  SNEAK: PENDING,
  TERRIFY: PENDING,
});

export const IRYNA: CharacterSheet = {
  id: "iryna",
  name: "Iryna",
  blurb: "Ranged occultist.",
  stats: { ...zeroStats(), SHOOT: 3 }, // SHOOT 3 confirmed by golden test A
  abilities: [],
  specials: [
    {
      id: "iryna-reduce-attack",
      name: "Suppressing Ritual",
      text: "Reduce a Threat's Attack (flat).",
      trigger: { type: "crit" },
    },
    {
      id: "iryna-ubermensch-damage",
      name: "Banishing Bolt",
      text: "Inflict flat damage to an Übermensch.",
      trigger: { type: "crit" },
      advanceGated: true,
    },
  ],
  equipment: [
    {
      id: "iryna-rifle",
      name: "Exquisite Hunting Rifle",
      bonus: { tag: "elevated", plus: 1 }, // +elevated position
    },
    {
      id: "iryna-runes",
      name: "Explosive Runes",
      bonus: { tag: "concealed", plus: 2 }, // ++concealed
    },
  ],
};

export const NICOLE: CharacterSheet = {
  id: "nicole",
  name: "Nicole",
  blurb: "Demolitions.",
  stats: zeroStats(),
  abilities: [],
  specials: [
    {
      id: "nicole-scavenger",
      name: "Scavenger",
      text: "Roll d6; match the [n] bracket on a weapon; restore 1 use of it.",
      trigger: { type: "condition" }, // NOT crit-gated (RULES §10)
    },
    {
      id: "nicole-sapper",
      name: "Sapper",
      text: "With explosives, reduce a target's Challenge by 1.",
      trigger: { type: "crit" },
    },
  ],
  // Gear carries [1]..[6] ids for Scavenger matching (RULES §10).
  equipment: [],
};

export const COSGRAVE: CharacterSheet = {
  id: "cosgrave",
  name: "Cosgrave",
  blurb: "Necromancer.",
  stats: zeroStats(),
  abilities: [],
  specials: [
    {
      id: "cosgrave-dead-mans-luck",
      name: "Dead Man's Luck",
      text: "Pre-discard passive: −1 GM successful die per 1 the player rolled.",
      trigger: { type: "condition" },
      advanceGated: true,
    },
  ],
  equipment: [
    {
      id: "cosgrave-soul-jar",
      name: "Soul Jar",
      uses: 1,
      bonus: { tag: "ritual", plus: 4 }, // 1-use, +4 bonus dice (RULES §10)
    },
  ],
};

export const CHUCK: CharacterSheet = {
  id: "chuck",
  name: "Chuck",
  blurb: "Ghoul.",
  stats: zeroStats(),
  abilities: [],
  specials: [
    {
      id: "chuck-corpse-eater",
      name: "Corpse Eater",
      text: "Pre-discard passive: +1 Blood if any 1 was rolled.",
      trigger: { type: "condition" },
    },
    {
      id: "chuck-elbow-grease",
      name: "Elbow Grease",
      text: "On a SOLO FIX Objective action, a crit reduces that Objective's rating by 4.",
      trigger: {
        type: "crit",
        requires: { solo: true, stat: "FIX", targetKind: "objective" },
      },
      advanceGated: true,
    },
  ],
  equipment: [
    {
      id: "chuck-cowboy-hat",
      name: "Cowboy Hat",
      uses: 1, // one-time ignore an Injury/Downed, then destroyed (RULES §10)
    },
  ],
};

export const ASTRID: CharacterSheet = {
  id: "astrid",
  name: "Astrid",
  blurb: "Predator.",
  stats: zeroStats(),
  abilities: [],
  specials: [
    {
      id: "astrid-apex-predator",
      name: "Apex Predator",
      text: "Reduce a Threat's rating by 3.",
      trigger: { type: "crit" },
    },
    {
      id: "astrid-unnatural-endurance",
      name: "Unnatural Endurance",
      text: "Remove 3 GM Attack dice.",
      trigger: { type: "crit" },
    },
    {
      id: "astrid-nightmare-regeneration",
      name: "Nightmare Regeneration",
      text: "Clear an Injury.",
      trigger: { type: "crit" },
      advanceGated: true,
    },
  ],
  equipment: [],
};

export const FLINT: CharacterSheet = {
  id: "flint",
  name: "Flint",
  blurb: "Bat-monster.",
  stats: zeroStats(),
  abilities: [],
  specials: [
    {
      id: "flint-bone-armour",
      name: "Bone Armour",
      text: "Pre-discard passive: −1 GM successful die per 1 the player rolled.",
      trigger: { type: "condition" },
      advanceGated: true,
    },
    {
      id: "flint-ravenous",
      name: "Ravenous",
      text: "In melee: +3 Blood.",
      trigger: { type: "crit", requires: { tag: "melee" } },
    },
    {
      id: "flint-wings",
      name: "Wings",
      text: "Flight / aerial positioning.",
      trigger: { type: "condition" },
    },
  ],
  equipment: [],
};

export const CHARACTERS: CharacterSheet[] = [
  IRYNA,
  NICOLE,
  COSGRAVE,
  CHUCK,
  ASTRID,
  FLINT,
];

export const CHARACTERS_BY_ID: Record<string, CharacterSheet> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);
