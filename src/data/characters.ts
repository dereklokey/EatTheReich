import type { Stat } from "../domain/types.js";
import type { CharacterSheet, InjuryCategory } from "../domain/character.js";

/**
 * The six fixed pregens, transcribed from the rulebook character sheets (pp. 14–24)
 * and mechanics (pp. 30–41). The rulebook is the source of truth.
 *
 * Equipment use counts are the literal pip boxes printed beside each item on the
 * sheet (counted off the PDF — the last box is drawn in the character's accent colour
 * but is still a use). There is NO formula tying uses to the +bonus; each item's count
 * is whatever the sheet prints, e.g. Chuck's revolvers have 5, his tool belt 4.
 *
 * Passive ids the engine recognises: "corpse-eater", "dead-mans-luck", "bone-armour"
 * (see engine/passives.ts).
 */

const stats = (
  brawl: number,
  con: number,
  fix: number,
  search: number,
  shoot: number,
  sneak: number,
  terrify: number,
): Record<Stat, number> => ({
  BRAWL: brawl,
  CON: con,
  FIX: fix,
  SEARCH: search,
  SHOOT: shoot,
  SNEAK: sneak,
  TERRIFY: terrify,
});

const injuries = (
  cat12: [string, [string, string]],
  cat34: [string, [string, string]],
  cat56: [string, [string, string]],
): [InjuryCategory, InjuryCategory, InjuryCategory] => [
  { faces: [1, 2], boxes: [{ label: cat12[1][0] }, { label: cat12[1][1], penalty: cat12[0] }] },
  { faces: [3, 4], boxes: [{ label: cat34[1][0] }, { label: cat34[1][1], penalty: cat34[0] }] },
  { faces: [5, 6], boxes: [{ label: cat56[1][0] }, { label: cat56[1][1], penalty: cat56[0] }] },
];

export const IRYNA: CharacterSheet = {
  id: "iryna",
  name: "Iryna",
  blurb: "Old Money undead occultist and bonne vivante; a gothic socialite warlock.",
  hooks: [
    "Black sheep of a well-established vampyr clan",
    "Ancestral home (and family) torn apart by nazis",
    "Providing a significant portion of F.A.N.G. funding",
  ],
  stats: stats(2, 4, 2, 2, 3, 1, 3),
  equipment: [
    { id: "iryna-rifle", name: "Exquisite hunting rifle", uses: 5, bonus: { tag: "elevated position", plus: 1 } },
    { id: "iryna-sabre", name: "Magic cavalry sabre", uses: 5, bonus: { tag: "charge!", plus: 1 } },
    { id: "iryna-runes", name: "Explosive runes", uses: 3, bonus: { tag: "concealed", plus: 2 } },
    { id: "iryna-cigarettes", name: "Cigarettes taken from the pockets of hanged men", uses: 3, addsDie: false, note: "mark to regain 2 Blood", reactive: { blood: 2 } },
  ],
  abilities: [
    { id: "iryna-dark-glamour", name: "Dark Glamour", text: "Those nearby are mesmerised by your unearthly visage.", mechanic: "active", bloodCost: 1, bonus: { tag: "beautiful surroundings", plus: 1 } },
    { id: "iryna-nights-servants", name: "Night's Willing Servants", text: "Summon a swarm of bats under your control.", mechanic: "active", bloodCost: 1, bonus: { tag: "old buildings", plus: 1 } },
    { id: "iryna-deadeye-shot", name: "Deadeye Shot", text: "When you use a ranged weapon: reduce a Threat's Attack rating by 1.", mechanic: "special", trigger: { type: "crit", requires: { tag: "ranged weapon" } }, reduceThreatAttack: 1 },
  ],
  advances: [
    { id: "iryna-hells-fire", name: "Hell's Ravenous Fire", text: "Ignore Challenge on your next action against a Threat.", mechanic: "active", bloodCost: 1, addsDie: false },
    { id: "iryna-enervation", name: "Enervation of the Soul", text: "On your next roll, gain SPECIAL: inflict 4 damage to an Übermensch.", mechanic: "active", bloodCost: 1, addsDie: false },
    { id: "iryna-mantle", name: "Mantle of the Fell Beast", text: "BRAWL and TERRIFY become 4, all other stats are set to 1, and you cannot use items. Lasts until the Objective is completed.", mechanic: "active", bloodCost: 2, addsDie: false },
  ],
  injuries: injuries(
    ["Can't use + dice", ["Suit Torn", "Abdominal Puncture"]],
    ["+2 BRAWL, -2 CON", ["Hair Ruined", "Headshot"]],
    ["May only use 1 item per turn", ["Shoulder Injury", "Arm Removed"]],
  ),
  lastStand: "Forbidden Sorceries",
};

export const NICOLE: CharacterSheet = {
  id: "nicole",
  name: "Nicole",
  blurb: "Resistance guerrilla fighter and demolitions expert.",
  hooks: [
    "Packing more heat than a whole platoon",
    "Lost your cell to nazi purges, bitter about it",
    "Bitten by your (now dead) vampire girlfriend",
    "Desperate to meet a glorious end in battle",
  ],
  stats: stats(2, 2, 1, 2, 4, 3, 3),
  equipment: [
    { id: "nicole-m3", name: "M3 submachine gun", scavengerSlot: 1, uses: 4, bonus: { tag: "flanking", plus: 1 } },
    { id: "nicole-lee-enfield", name: "Cut-down Lee Enfield rifle", scavengerSlot: 2, uses: 4, bonus: { tag: "close quarters", plus: 1 } },
    { id: "nicole-smoke", name: "Smoke grenades", scavengerSlot: 3, uses: 3, bonus: { tag: "cover advance", plus: 1 } },
    { id: "nicole-firebombs", name: "Firebombs", scavengerSlot: 4, uses: 2, bonus: { tag: "firetrap", plus: 2 } },
    { id: "nicole-panzerfaust", name: "Panzerfaust", scavengerSlot: 5, uses: 1, bonus: { tag: "armoured target", plus: 3 } },
    { id: "nicole-dynamite", name: "Dynamite", scavengerSlot: 6, uses: 1, bonus: { tag: "demolitions", plus: 4 } },
  ],
  abilities: [
    { id: "nicole-scavenger", name: "Scavenger", text: "Roll a D6 and compare it to the [n] numbers on your equipment list; restore 1 use of the weapon rolled.", mechanic: "special", trigger: { type: "crit" } },
    { id: "nicole-sapper", name: "Sapper", text: "When you use explosives: reduce an Objective or Threat's Challenge by 1.", mechanic: "special", trigger: { type: "crit", requires: { tag: "explosives" } }, reduceChallenge: 1 },
    { id: "nicole-blink", name: "Blink", text: "Burst into shadows and reform a few feet away.", mechanic: "active", bloodCost: 1, bonus: { tag: "infiltration", plus: 1 } },
  ],
  advances: [
    { id: "nicole-rat-swarm", name: "Rat Swarm", text: "Summon a swarm of rats under your control.", mechanic: "active", bloodCost: 1, bonus: { tag: "filth", plus: 2 } },
    { id: "nicole-feed-on-fear", name: "Feed on Fear", text: "When you reduce a Threat rating to 0, gain 3 Blood.", mechanic: "passive" },
    { id: "nicole-pitch-black", name: "Pitch Black", text: "Plunge the area around you into shadow; you can see fine.", mechanic: "active", bloodCost: 1, bonus: { tag: "ambush", plus: 2 } },
  ],
  injuries: injuries(
    ["Can't trigger specials", ["Dazed", "Headshot"]],
    ["Spend 1 Blood at the start of your turn", ["Just a Graze", "Bleeding Out"]],
    ["May only use 1 item per turn", ["Hand Injury", "Lost an Arm"]],
  ),
  lastStand: "Rigged to Blow",
};

export const COSGRAVE: CharacterSheet = {
  id: "cosgrave",
  name: "Cosgrave",
  blurb: "Hackney necromancer; an East London wideboy, medically dead.",
  hooks: [
    "Taught by your aunt",
    "On the run from East London's undead mafia",
    "Crooked as a three bob note, but charming with it",
    "Lots of weird black magic tricks",
  ],
  stats: stats(2, 3, 3, 2, 2, 3, 2),
  equipment: [
    { id: "cosgrave-knife", name: "Enormous knife", uses: 4, bonus: { tag: "never saw you coming", plus: 1 } },
    { id: "cosgrave-shotgun", name: "Sawn-off shotgun", uses: 3, bonus: { tag: "point-blank", plus: 2 } },
    { id: "cosgrave-bottled-ghosts", name: "Bottled ghosts", uses: 2, bonus: { tag: "pass through walls", plus: 2 } },
    // Sheet prints (+++any); the mechanics prose (p31) loosely calls it "four bonus
    // dice" (the +3 bonus plus the use die). Encoded as the sheet: +++ = 3, 1 use.
    { id: "cosgrave-soul-jar", name: "Mother Millicent's stolen soul jar", uses: 1, bonus: { tag: "any", plus: 3 } },
  ],
  abilities: [
    { id: "cosgrave-danse-macabre", name: "Danse Macabre", text: "Gain full control of a corpse for around a minute, after which it falls apart.", mechanic: "active", bloodCost: 1, bonus: { tag: '"Hans, are you okay?"', plus: 1 } },
    { id: "cosgrave-back-pocket-hex", name: "Back-Pocket Hex", text: "Reduce a Threat's Attack rating by 1.", mechanic: "special", trigger: { type: "crit" }, reduceThreatAttack: 1 },
    { id: "cosgrave-phantasmagoria", name: "Phantasmagoria", text: "Conjure nightmare illusions in the area immediately around you.", mechanic: "active", bloodCost: 1, bonus: { tag: "incorporates the background in a clever way", plus: 1 } },
  ],
  advances: [
    { id: "cosgrave-memory-rot", name: "Memory Rot", text: "Remove or implant memories from someone you lock eyes with.", mechanic: "active", bloodCost: 1, bonus: { tag: "you were never here", plus: 1 } },
    { id: "cosgrave-death-burst", name: "Death Burst", text: "Curse a nazi within arm's reach to explode when they die.", mechanic: "active", bloodCost: 1, bonus: { tag: "enclosed spaces", plus: 2 } },
    { id: "dead-mans-luck", name: "Dead Man's Luck", text: "After you roll your dice pool, before you discard dice, reduce the GM's successful Attack dice by 1 for each 1 you rolled.", mechanic: "passive" },
  ],
  injuries: injuries(
    ["-1 to all stats", ["Lost Some Fingers", "Arm Ripped Off"]],
    ["+2 TERRIFY, -2 CON", ["Sucking Chest Wound", "Shot in the Face"]],
    ["Can't spend Blood to use abilities", ["Grimoire Damaged", "Wards Compromised"]],
  ),
  lastStand: "Undead Horde",
};

export const CHUCK: CharacterSheet = {
  id: "chuck",
  name: "Chuck",
  blurb: "A rotting cowboy just trying to get along; genuinely decent, apart from the eating-people bit.",
  hooks: [
    "Grew up on the wrong side of the tracks, buried a sibling or two",
    "Loves cowboy movies, honest work, human liver and the wide open plains",
    "F.A.N.G. pulled you out of jail after you ate a county sheriff and half his deputy",
  ],
  stats: stats(3, 1, 4, 2, 3, 2, 2),
  equipment: [
    { id: "chuck-revolvers", name: "Paired revolvers, Betsy and Maria", uses: 5, bonus: { tag: "duel", plus: 1 } },
    { id: "chuck-tool-belt", name: "Tool belt", uses: 4, bonus: { tag: "Jerry-rigging", plus: 1 } },
    { id: "chuck-cowboy-hat", name: "Cowboy hat", uses: 1, addsDie: false, note: "mark to ignore an Injury or being Downed; hat is destroyed", reactive: { ignoreInjury: true } },
  ],
  abilities: [
    { id: "chuck-acid-spit", name: "Acid Spit", text: "Hawk up a gutful of fierce acid.", mechanic: "active", bloodCost: 1, bonus: { tag: "vs metal", plus: 2 } },
    { id: "chuck-spider-scurry", name: "Spider Scurry", text: "Skitter across ceilings and up walls.", mechanic: "active", bloodCost: 1, bonus: { tag: "low ceilings", plus: 1 } },
    { id: "corpse-eater", name: "Corpse Eater", text: "After you roll your dice pool, before you discard dice, gain 1 Blood if you rolled any 1s.", mechanic: "passive" },
  ],
  advances: [
    { id: "chuck-elbow-grease", name: "Elbow Grease", text: "When you take on an Objective single-handed with the FIX stat: reduce the Objective's rating by 4.", mechanic: "special", trigger: { type: "crit", requires: { solo: true, stat: "FIX", targetKind: "objective" } } },
    { id: "chuck-corrosive-fluids", name: "Corrosive Fluids", text: "When you mark an Injury, reduce the rating of a Threat you're engaged with by 2.", mechanic: "passive" },
    { id: "chuck-lashing-tongue", name: "Lashing Tongue", text: "Your strong, prehensile tongue extends several yards out of your mouth.", mechanic: "active", bloodCost: 1, bonus: { tag: "restrain", plus: 1 } },
  ],
  injuries: injuries(
    ["Spend 1 Blood at the start of your turn", ["Flesh Wound", "Shot Fulla Holes"]],
    ["-1 to all stats", ["Limping", "Crawling"]],
    ["Can't use + dice", ["Mauled", "Eviscerated"]],
  ),
  lastStand: "Go Down Shooting",
};

export const ASTRID: CharacterSheet = {
  id: "astrid",
  name: "Astrid",
  blurb: "Ex-fighter pilot with an ancient predator soul coiled around her own.",
  hooks: [
    "Bitten by something after a crash in the frozen taiga",
    "Ancient magic flows in your blood and wild spirits bow to you",
    "(But in case that fails, you also have a machine gun)",
  ],
  stats: stats(3, 1, 2, 3, 2, 2, 4),
  equipment: [
    { id: "astrid-machine-gun", name: "Machine Gun", uses: 4, bonus: { tag: "enemies in cover", plus: 1 } },
    { id: "astrid-greatspear", name: "Greatspear", uses: 4, bonus: { tag: "receive a charge", plus: 1 } },
    { id: "astrid-frag-grenades", name: "Fragmentation Grenades", uses: 2, bonus: { tag: "enclosed spaces", plus: 2 } },
    { id: "astrid-spirit-fetters", name: "Spirit Fetters", uses: 2, bonus: { tag: "animals", plus: 3 } },
  ],
  abilities: [
    { id: "astrid-apex-predator", name: "Apex Predator", text: "Reduce a Threat's rating by 3.", mechanic: "special", trigger: { type: "crit" }, reduceThreatRating: 3 },
    { id: "astrid-unnatural-endurance", name: "Unnatural Endurance", text: "Reduce the GM's Attack dice by 3.", mechanic: "special", trigger: { type: "crit" }, reduceGmDice: 3 },
    { id: "astrid-bloodhunt", name: "Bloodhunt", text: "Track targets or search for things using your sense of smell.", mechanic: "active", bloodCost: 1, bonus: { tag: "target fleeing", plus: 1 } },
  ],
  advances: [
    { id: "astrid-nightmare-regeneration", name: "Nightmare Regeneration", text: "Clear a marked Injury.", mechanic: "special", trigger: { type: "crit" } },
    { id: "astrid-spirit-storm", name: "Spirit Storm", text: "Hurl items like a poltergeist.", mechanic: "active", bloodCost: 1, bonus: { tag: "something sharp AND heavy", plus: 2 } },
    { id: "astrid-tethered-phantom", name: "Tethered Phantom", text: "Reduce an Objective or Threat's Challenge by 1 until the end of the round.", mechanic: "active", bloodCost: 1, addsDie: false },
  ],
  injuries: injuries(
    ["Can't trigger Specials", ["Spirits Cowed", "Spirits Cast Out"]],
    ["+2 SNEAK, -2 TERRIFY", ["Sigils Marred", "Bleeding Shadows"]],
    ["-1 to all stats", ["Limping", "Ruined Leg"]],
  ),
  lastStand: "Unleash the Spirits",
};

export const FLINT: CharacterSheet = {
  id: "flint",
  name: "Flint",
  blurb: "A half-bat, half-human monstrosity who lives in a cave.",
  hooks: [
    "Born in a cave, driven out by nazis",
    "Monstrous hunter with a taste for blood",
    "May or may not be able to talk (possibly just shy)",
  ],
  stats: stats(4, 2, 2, 2, 1, 3, 3),
  equipment: [
    { id: "flint-claws", name: "Steel gouging claws", uses: 4, bonus: { tag: "ambush", plus: 1 } },
    { id: "flint-grappling-hook", name: "Grappling hook", uses: 3, bonus: { tag: "three or more storeys", plus: 2 } },
  ],
  abilities: [
    { id: "flint-ravenous", name: "Ravenous", text: "When you're in melee combat: gain 3 Blood.", mechanic: "special", trigger: { type: "crit", requires: { tag: "melee" } }, grantsBlood: 3 },
    { id: "flint-sense-heartbeat", name: "Sense Heartbeat", text: "See the heartbeats of living beings through walls and other obstacles.", mechanic: "active", bloodCost: 1, bonus: { tag: "dense cover", plus: 1 } },
    { id: "flint-improvised-projectile", name: "Improvised Projectile", text: "Chuck something large and heavy a surprising distance.", mechanic: "active", bloodCost: 1, bonus: { tag: "aerodynamic", plus: 1 } },
    { id: "flint-wings", name: "Wings", text: "You can fly.", mechanic: "active", bloodCost: 1, bonus: { tag: "aerial combat", plus: 1 } },
  ],
  advances: [
    { id: "flint-hellish-screech", name: "Hellish Screech", text: "Reduce a Threat's Challenge by 1.", mechanic: "active", bloodCost: 2, addsDie: false },
    { id: "bone-armour", name: "Bone Armour", text: "After you roll your dice pool, before you discard dice, reduce the GM's successful Attack dice by 1 for each 1 you rolled.", mechanic: "passive" },
    { id: "flint-ooze-form", name: "Ooze Form", text: "Squeeze through gaps, glop around, etc.", mechanic: "active", bloodCost: 1, bonus: { tag: "it's in the walls!", plus: 1 } },
  ],
  injuries: injuries(
    ["Can't gain Blood from nazis", ["Teeth Smashed", "Jaw Broken"]],
    ["+2 SEARCH, -2 BRAWL", ["Spooked", "Broken"]],
    ["Can't use + dice", ["Hamstrung", "Eviscerated"]],
  ),
  lastStand: "Final Form",
};

export const CHARACTERS: CharacterSheet[] = [IRYNA, NICOLE, COSGRAVE, CHUCK, ASTRID, FLINT];

export const CHARACTERS_BY_ID: Record<string, CharacterSheet> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);
