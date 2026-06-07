/**
 * Location reference data (rulebook pp. 50–64) — the GM's "suggested board" for
 * each scene (CLAUDE.md §4 GM panel: "load a location's suggested board"). Enemy
 * entries are free-form refs (some read "same stats as X"); resolve them against
 * the threat catalog in threats.ts. Ratings/Challenge are GM defaults, overridable.
 */

export type Sector = 3 | 2 | 1;

export interface LocationObjective {
  name: string;
  rating: number;
  challenge?: number;
}

export interface LootRef {
  name: string;
  /** Bonus requirement text, e.g. "++anti-tank". */
  bonus?: string;
  note?: string;
}

export interface SecondaryObjectiveRef {
  name: string;
  rating: number;
  /** Free-text reward (effects/flavour) shown on the secondary objective. */
  reward?: string;
  /** Slot-free special gear unlocked on completion (rulebook p39). */
  rewardEquipment?: { name: string; bonus?: string; note?: string }[];
}

/**
 * A scene's enemy: a free-form reference line (a name, an "x2" count, or "same stats as …"),
 * optionally flagged `staged` (issue #12). A plain string is in-play-at-start; the object
 * form marks an enemy the scene foreshadows as arriving later / conditional / the climax, so
 * it loads onto the board OUT of play for the GM to activate when it shows up. An explicit
 * flag, not a parse of the cue text.
 */
export type EnemyRef = string | { ref: string; staged: true };

export interface Location {
  id: string;
  name: string;
  sector: Sector;
  objectives: LocationObjective[];
  /** Free-form enemy references (names or "same stats as …"); some staged (issue #12). */
  enemies: EnemyRef[];
  /** Übermensch present, if any. */
  ubermensch?: string;
  loot?: LootRef[];
  secondaryObjectives?: SecondaryObjectiveRef[];
}

export const LOCATIONS: Location[] = [
  // ── Sector 3 — starting sections ──────────────────────────────────────────
  {
    id: "place-de-la-sirene",
    name: "Place de la Sirène",
    sector: 3,
    objectives: [{ name: "Get out of the open and into cover", rating: 6 }],
    enemies: ["Police Patrol x2"],
  },
  {
    id: "grand-magasin-martin",
    name: "Grand Magasin Martin",
    sector: 3,
    objectives: [{ name: "Find your way out of the maze-like building", rating: 6 }],
    enemies: ["Infantry Squad (sent in to find the vampires)", { ref: "Armoured Car (waiting outside)", staged: true }],
  },
  {
    id: "graveyard",
    name: "Graveyard",
    sector: 3,
    objectives: [{ name: "Ruin that funeral", rating: 6 }],
    enemies: ["Infantry Squad (unprepared but still armed)"],
  },
  {
    id: "hotel-letoile",
    name: "Hôtel l'Étoile",
    sector: 3,
    objectives: [{ name: "Make a suitable entrance", rating: 6 }],
    enemies: ["Nazi officers having a drink x2 (same stats as Police Patrol)"],
  },
  {
    id: "catacombs",
    name: "Catacombs",
    sector: 3,
    objectives: [{ name: "Get into (and subsequently out of) the subterranean labyrinth", rating: 6, challenge: 1 }],
    enemies: ["Armoured Infantry Squad (scared out of their wits)"],
  },
  {
    id: "saint-medard-church",
    name: "Saint-Médard Church",
    sector: 3,
    objectives: [{ name: "Punch a hole in the attacking line and get out of there", rating: 8 }],
    enemies: ["Infantry Squad x2", "Sniper Team (in an adjacent building)"],
    loot: [{ name: "Particularly huge cross", bonus: "++swing for the fences" }],
  },

  // ── Sector 2 — the bulk of the assault ────────────────────────────────────
  {
    id: "german-technology-pavilion",
    name: "The German Technology Pavilion",
    sector: 2,
    objectives: [{ name: "Storm the pavilion and get out the other side", rating: 9 }],
    enemies: [{ ref: "Stahlsoldat", staged: true }], // dormant; powers up when roused
    ubermensch: "Stahlsoldat",
    loot: [
      { name: "Prototype beam emitter", bonus: "++++properly calibrated before firing" },
      { name: "Loose, glowing fuel source", bonus: "++near flammable material" },
    ],
    secondaryObjectives: [
      {
        name: "Power up the weapons platform",
        rating: 5,
        reward: "These do not occupy Loot slots.",
        rewardEquipment: [
          { name: "Quadrupedal weapons platform", bonus: "+shrug off incoming fire" },
          { name: "Microwave array turret", bonus: "+++anti-tank" },
        ],
      },
    ],
  },
  {
    id: "metro-station",
    name: "Metro Station",
    sector: 2,
    objectives: [{ name: "Cut through the metro tunnels", rating: 10 }],
    enemies: ["Armoured Infantry Squad x2", { ref: "Motorcycle Squad (dispatched if you get a train working)", staged: true }],
  },
  {
    id: "expensive-looking-garage",
    name: "Expensive-Looking Garage",
    sector: 2,
    objectives: [{ name: "Steal something flashy and get the hell out of there", rating: 8 }],
    enemies: ["Infantry Squad in an Armoured Car (giving chase)", "Sniper Team (on an adjacent rooftop)"],
    loot: [
      { name: "Open-topped Italian speedster", bonus: "++stunts" },
      { name: "Reliable German import", bonus: "++tight turns" },
      { name: "Unremarkable French jalopy", bonus: "++go unnoticed" },
    ],
  },
  {
    id: "le-cochon-noir",
    name: "Le Cochon Noir (French Resistance Hideout)",
    sector: 2,
    objectives: [{ name: "Lose the nazis by hiding in the bar", rating: 6 }],
    enemies: ["Police Patrol x2", { ref: "Infantry Squad in an Armoured Car (turn up halfway through)", staged: true }],
    secondaryObjectives: [
      {
        name: "Team up with the Resistance",
        rating: 4,
        reward: "Does not occupy a Loot slot.",
        rewardEquipment: [{ name: "Guerrilla Squad", bonus: "+flanking manoeuvre" }],
      },
    ],
  },
  {
    id: "museum-of-european-warfare",
    name: "Museum of European Warfare",
    sector: 2,
    objectives: [{ name: "Smash through the museum before you're overwhelmed by the undead", rating: 8, challenge: 1 }],
    enemies: ["Einherjar", "Museum Guards (same stats as Police Patrol)"],
    loot: [
      { name: "Painstakingly maintained masterwork greatbow", bonus: "++silent killer" },
      { name: "Still-functional improbably loaded cannon", bonus: "+++immobile target" },
      { name: "Turncoat warrior mummy", bonus: "+bandage restraints" },
      { name: "Napoleon's undead horse", bonus: "+trample" },
    ],
  },
  {
    id: "jardin-de-fee",
    name: "Jardin de Fée (Illuminations and Amusements)",
    sector: 2,
    objectives: [{ name: "Navigate a collapsing fairground whilst hunted by an entropy witch", rating: 10, challenge: 1 }],
    enemies: ["Tank crew (same stats as Police Patrol)", { ref: "Rust-Witch", staged: true }], // riding the ferris wheel towards you
    ubermensch: "Rust-Witch",
  },
  {
    id: "exhibition-of-degenerate-art",
    name: "Exhibition of Degenerate Art",
    sector: 2,
    objectives: [{ name: "Undertake a very quick and violent gallery tour", rating: 8 }],
    enemies: ["Infantry Squad in an Armoured Car (smashing through the wall)", "Art-Burning Brigade (as Police but Attack 4 — flamethrowers)"],
    secondaryObjectives: [{ name: "Track down a lost Van Gogh or something", rating: 4, reward: "No mechanical benefit — but you've got a lost masterpiece" }],
  },
  {
    id: "concert-hall",
    name: "Concert Hall",
    sector: 2,
    objectives: [{ name: "Hustle through the corridors towards Hitler, ignoring the Übermensch", rating: 4 }],
    enemies: ["Dämonenblut"],
    ubermensch: "Dämonenblut",
  },

  // ── Sector 1 — endgame ────────────────────────────────────────────────────
  {
    id: "ammunition-and-vehicle-depot",
    name: "Ammunition and Vehicle Depot",
    sector: 1,
    objectives: [{ name: "Scramble across the motor pool", rating: 8 }],
    enemies: ["Motorcycle Squad", "Infantry Squad (guarding)", { ref: "Tank (after you defeat one enemy)", staged: true }],
    loot: [{ name: "The souped-up bullet-proof black Volkswagen of your dreams", bonus: "++front-mounted machine guns" }],
    secondaryObjectives: [{ name: "Raid the ammunition dump", rating: 4, reward: "Each player restores all uses of any firearms, grenades or similar weapons" }],
  },
  {
    id: "nazi-pleasure-gardens",
    name: "Nazi Pleasure Gardens",
    sector: 1,
    objectives: [{ name: "Blitzkrieg the garden party", rating: 8 }],
    enemies: ["Carousing Officers (same stats as Infantry Squad)", "Sniper Team x2"],
  },
  {
    id: "eiffel-tower",
    name: "The Eiffel Tower",
    sector: 1,
    objectives: [{ name: "Ascend the Eiffel Tower", rating: 8, challenge: 1 }],
    enemies: ["Armoured Infantry Squad (waiting for you)", { ref: "Paratrooper Squad (landing on the top and sides)", staged: true }],
  },
  {
    id: "fuhrers-zeppelin",
    name: "The Führer's Zeppelin",
    sector: 1,
    objectives: [{ name: "Reach Hitler's Broadcast Suite", rating: 6, challenge: 1 }],
    enemies: ["Vampirjäger Cadre", { ref: "Werhund (the climax — reduce to 0 and Hitler is at your mercy)", staged: true }],
    ubermensch: "Werhund",
  },
  {
    id: "hitlers-broadcast-suite",
    name: "Hitler's Broadcast Suite",
    sector: 1,
    // The finale is the Werhund fight (in the Zeppelin); Hitler himself poses no
    // direct threat and gets no monologue (rulebook p67).
    objectives: [],
    enemies: ["Hitler (no direct threat; he runs and cowers — no voice, no monologue)"],
  },
];

export const LOCATIONS_BY_SECTOR: Record<Sector, Location[]> = {
  3: LOCATIONS.filter((l) => l.sector === 3),
  2: LOCATIONS.filter((l) => l.sector === 2),
  1: LOCATIONS.filter((l) => l.sector === 1),
};

export const LOCATIONS_BY_ID: Record<string, Location> = Object.fromEntries(
  LOCATIONS.map((l) => [l.id, l]),
);
