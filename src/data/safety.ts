/**
 * Safety reference data (rulebook pp. 6–7 & the Evil Calibration Checklist p68).
 * Transcribed from the book (the project owner's source of truth). This is read-only
 * reference the Session-0 panel shows so the table can discuss and calibrate; the
 * table's actual choices (Lines, Veils, and any calibration adjustments) live on the
 * game as `SafetyState` (set via the `set_safety` intent), not here.
 *
 * Safety copy stays plain and serious — never jokey (CLAUDE.md §7, DESIGN.md §8).
 */

export interface CalibrationTier {
  /** The heading describing how the table relates to this degree of bad behaviour. */
  heading: string;
  /** Example bullet points the table can move up or down the scale (p68). */
  examples: string[];
}

/** The four degrees of "bad behaviour", with the book's example bullets (p68). */
export const EVIL_CALIBRATION_TIERS: CalibrationTier[] = [
  {
    heading: "Evil inherent to the setting — we engage with it, but never question or interrogate it.",
    examples: [
      "Vampires drinking human blood to survive.",
      "Killing nazis.",
      "Enjoying killing nazis.",
      "Killing nazis in over-the-top, ultraviolent, even cartoonish ways.",
      "Property destruction.",
    ],
  },
  {
    heading: "Evil we engage with, but which may be a point of conflict between characters.",
    examples: [
      "Europeans making snarky comments about other European cultures.",
      "Helping or working with nazis who say they're only nazis under coercion or threat.",
      "Patriotic nationalism (classical nation-states, not white nationalism).",
      "Vampire exceptionalism (vampires acting like they're better than humans).",
      "Drinking (some of) the blood of innocent or consenting people.",
      "Drinking (all of) the blood of nazis.",
      "Militarism.",
      "Other crimes.",
      "Property destruction of cultural treasures like the Arc de Triomphe.",
    ],
  },
  {
    heading: "Evil which will happen, but the players won't do it — and will oppose it when it shows up.",
    examples: [
      "Murdering innocents.",
      "Fascism.",
      "Cruelty (including violence unrelated to your objectives, like torture).",
      "Ableism, racism, sexism, queerphobia, religious intolerance.",
      "Snarky comments about other cultures that cross over into punching down.",
      "Any other violations of war-crime statutes.",
      "Violence against animals.",
      "Magical mind control.",
      "Blood libel.",
    ],
  },
  {
    heading: "Evil no one does, even villains.",
    examples: ["Sexual assault.", "Violence against children."],
  },
];

/**
 * Any item on the scale can also be *veiled* (p68): if it happens it's off-screen /
 * not described in detail. By default, saying slurs aloud and doing Roman salutes is
 * veiled — if they happen, just say that a nazi does it; don't act it out.
 */
export const VEIL_DEFAULT_NOTE =
  "By default, slurs and Roman salutes are veiled: if they happen, just say that a nazi does it — don't act it out.";
