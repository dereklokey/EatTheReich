# DESIGN.md — Visual style & interaction feel

> Frontend art-direction and motion contract for the Eat the Reich companion app.
> Goal: the app should feel like the **book** — a blood-spattered wartime dossier where
> ultraviolent pulp action erupts on every interaction — not a tidy productivity tool.
> Grounded in the actual page art (character intro spread, the dice-resolution diagram on
> p31, the dossier-paper body pages). Pairs with `CLAUDE.md` (build) and `RULES.md` (logic).
>
> Governing idea from the rulebook (p44): play is **ultraviolent, imprecise, over the top** —
> "a spectacle, far removed from the real-world elements of pain, fear and anger." The UI
> must be a *spectacle*. Clicks and dice rolls should feel disproportionately, joyfully big.

---

## 1. Aesthetic direction (commit to this)

**Maximalist wartime-occult dossier meets pulp splatter.** Not minimal, not clean. Every
surface looks like a classified F.A.N.G. file that's been carried through a firefight:
aged paper, redaction/highlighter marks, typewriter text, paperclips, blood spatter,
scorch. On top of that substrate, the *action* is loud — neon detonations, dice that slam,
crimson arterial spray on hits.

The one thing players should remember: **rolling dice feels like setting off a bomb.**

Two registers, held in tension:
- **The dossier (calm layer):** the persistent chrome — board, sheets, panels. Tactile,
  analog, aged, dense, legible. This is where you read and plan.
- **The spectacle (hot layer):** what happens on action — pool assembly, the roll, hits,
  feeding, criticals, deaths. Loud, kinetic, brief. This is where you *feel* it.

Restraint rule: the hot layer is only impactful because the calm layer is restrained.
Don't animate the dossier chrome ambiently everywhere; save the big motion for action beats.

---

## 2. Palette (from the book's own pages)

Use CSS variables. Dominant aged-paper + deep night, with arterial crimson and hazard
yellow as the sharp accents. (Sampled from the dice page and dossier spreads.)

```css
:root {
  /* Dossier substrate */
  --paper:        #e8dcc0;   /* aged manila body paper */
  --paper-shadow: #c8b896;   /* paper edge / layered-file shadow */
  --paper-ink:    #1c1a17;   /* typewriter near-black */
  --paper-fade:   #5a5346;   /* faded carbon text */

  /* Night / exterior (page backgrounds, board) */
  --night-top:    #1a1530;   /* deep indigo sky */
  --night-deep:   #0d0a1c;   /* near-black base */
  --dusk-mauve:   #3a2540;   /* horizon mauve */

  /* Accents — the loud ones */
  --blood:        #c0142e;   /* arterial crimson — hits, danger, GM */
  --blood-bright: #ff2d4a;   /* spray highlight / crit flash */
  --hazard:       #f2c014;   /* highlighter / hazard-stripe yellow — emphasis, success */
  --hazard-warm:  #e8941c;   /* fire/ember orange — explosions */

  /* Dice */
  --die-player:   #6a2b8a;   /* purple-marbled player die body */
  --die-player-2: #9c3bb0;   /* player die highlight */
  --die-pip:      #ff2d4a;   /* crimson numerals/pips on player dice */
  --die-gm:       #ede4d0;   /* bone/cream GM die body */
  --die-gm-pip:   #c0142e;   /* GM die pips */

  /* State */
  --success:      var(--hazard);
  --critical:     var(--blood-bright);
  --discard:      #4a4458;   /* muted — dice fading out */
}
```

Theme is **dark-dominant** for the app shell (night Paris), with **paper panels** floating
on top. Avoid the forbidden "purple-gradient-on-white" cliché — our purple is a *marbled
dice material*, never a flat web gradient, and the ground is night, not white.

---

## 3. Typography

Three voices, mapped to the book:

- **Display / headers** — a heavy condensed or stencil sans for section titles ("CHOOSING
  YOUR CHARACTER", "GO OUT WITH A BANG"), set in caps with a **hand-drawn underline**
  (an SVG squiggle, not `text-decoration`). Candidates: a military-stencil or bold
  grotesque with character. Treat headers as if rubber-stamped onto the file.
- **Body / mechanical text** — a **typewriter monospace** (the entire book body is mono).
  This is the single most identity-defining choice: stat readouts, ability text, log
  entries, narration all read as typed dossier text. Candidates: a warm, slightly
  irregular typewriter face (not a crisp coding mono).
- **Damage / fiction flourish** — a **blackletter / gothic** display face used *sparingly*
  for splatter words: the book sets "discard!" in gothic script. Reserve it for spectacle
  callouts ("DISCARD!", "CRITICAL!", "DOWNED", "LAST STAND"), never for UI labels.

Highlighter treatment: key terms get a **marker swipe** behind them — a slightly skewed,
semi-transparent `--hazard` (or `--blood` for danger) rectangle with rough edges, exactly
like the highlighted names/keywords in the book. Implement as a pseudo-element with a
hand-torn mask, not a clean `background-color`.

---

## 4. Surfaces & texture (the calm layer)

- **Layered-dossier background:** the app sits on stacked, slightly rotated aged-paper
  sheets over the night ground — visible edges, a paperclip or two, a bit of red string.
  Subtle, behind everything; it establishes "you are inside a war file."
- **Panels are paper:** objectives, sheets, the GM panel are manila cards with torn/burnt
  edges (irregular SVG/clip-path borders, not rounded rectangles), a faint paper grain
  noise overlay, and a soft drop shadow as if physically stacked.
- **Wear, not gloss:** coffee rings, faint ink smudges, a scorched corner, sparse blood
  flecks. Static and low-opacity — atmosphere, not distraction. One tasteful grain/noise
  overlay across the whole app ties it together.
- **Margins as dossier furniture:** rating tracks can echo the book's left-margin number
  columns (the 1–45 ledger numbers running down the page edge). Stamps, "RECEIVED" marks,
  and form-field fragments make good empty-state and header decoration.

Accessibility guardrail: texture lives in the *background*. Text always sits on a
sufficiently solid paper patch to stay high-contrast and legible. Provide a
**"reduce effects"** toggle (also auto-respect `prefers-reduced-motion`) that strips grain,
spatter, screen shake, and heavy particle work while keeping the layout and color identity.

---

## 5. The dice — the centerpiece

Match the book's dice exactly, because they're iconic and players already know them:

- **Player dice:** purple-marbled cube faces (`--die-player`→`--die-player-2` swirl, not a
  flat fill) with **crimson Roman numerals** (I–VI). The 6 (critical) is special: brighter,
  with an extra glow/embossing — it should read as "this one matters" at a glance.
- **GM dice:** bone/cream dice with **crimson pips** (dots, not numerals) — visually the
  enemy's dice, clearly "other." Smaller presence than player dice.
- **Discard treatment:** dice showing ≤ threshold don't just disappear — the gothic word
  **"discard!"** stamps over them (as in the book) and they crumble/desaturate to
  `--discard` and fall away.

Render as 2.5D (CSS 3D transforms) or high-quality 2D sprites; either is fine, but they
must have **weight** — thick edges, real shadow, a sense of mass when they land.

---

## 6. Interaction feel (the hot layer) — make it OVER THE TOP

The brief: **clicks and rolls trigger disproportionate, gleeful spectacle.** Below, per
moment, the intended feel. All of it is gated by the reduce-effects toggle.

### Building the pool
- Each die **slams** into the pool tray as you add its source (stat, weapon, ability),
  landing with a small impact, dust puff, and a paper-rattle. Adding a bonus die for a
  satisfied requirement gets a **hazard-yellow highlighter swipe** across the requirement
  text as the die drops in.
- The source of each die is labeled on a little tag (typewritten), so the pool reads as an
  assembled, narrated thing — "SHOOT", "rifle", "+elevated".

### The roll (the big moment)
- Trigger: a single deliberate action — drag the pool onto a "ROLL" detonator, or a big
  stamped button. On press: brief wind-up, then **dice explode outward** and tumble with
  physics, scattering across the table; a **screen shake**, a muzzle-flash bloom of
  `--hazard-warm`, and a low concussive thud.
- Dice settle; values resolve with a beat of suspense. **Successes (4–5)** flare
  hazard-yellow; the **critical (6)** detonates a crimson `--blood-bright` ring and a
  short slow-mo hold. **Discards** get the "discard!" stamp and crumble.
- This is the one screen everyone watches together (the "resolution theater") — orchestrate
  it as a **staggered sequence** (roll → settle → passives fire → discard → reveal), not all
  at once. Staggered reveal is where the drama lives.

### Allocation (drag dice onto targets)
- Dragging a die makes it glow and trail. Dropping it:
  - **Advance Objective:** the objective's rating track ticks down with a satisfying
    mechanical clunk; a hazard-yellow chunk knocks off the bar.
  - **Eliminate Threat:** **arterial crimson spray** bursts from the threat card, rating
    drops, the card lurches/recoils. Reducing a threat to 0 → a bigger gore burst and the
    card slumps/greys (defeated).
  - **Defend:** a GM Attack die is physically **knocked off the table** (flies off-screen
    with a clang) — viscerally satisfying, since defense is the survival lever.
  - **Feed:** the character's **Blood meter floods upward** in crimson, a drinking/gulp
    cue, a red vignette pulse at screen edges. Feeding should feel indulgent.
  - **Activate SPECIAL (crit):** full-screen moment — the character's signature flares,
    blackletter SPECIAL name stamps across the screen, unique color burst. Rare, so make
    it an event.
- Mid-allocation bonus dice (newly satisfied requirement): the new die(s) **drop in from
  above** onto the table mid-flow with the highlighter swipe — reinforcing that the pool is
  a living thing.

### Injuries / Downed / Death (the cost)
- **Injury:** the d6 category roll is its own small grim spectacle; marking a box stamps a
  blood-red X onto the character sheet with an ink-splat. Second box in a category (the
  penalty) gets a heavier, more alarming stamp + brief sheet shudder.
- **Downed:** the whole sheet desaturates and tilts; a torn "DOWNED" stamp slaps across it;
  the rescue Secondary Objective slides in.
- **Death / Last Stand:** the app's biggest moment. Screen goes dark-red, the gothic
  **"LAST STAND"** burns in, 8 dice assemble with funereal weight, and the final allocation
  plays in slow, heavy beats. Earn it.

### Blood sharing, healing, looting, flashbacks
- **Share Blood:** a crimson arc animates from giver to receiver across their sheets.
- **Heal (3 Blood):** Blood meter drains; the injury X dissolves; brief flesh-knitting
  shimmer over the box.
- **Loot:** the item "thunks" into the loot slot as a typed index-card with its bonus
  requirement; switching the active loot item flips the card with a tactile snap.
- **Flashback:** **sepia/desaturate** the whole table, a film-grain + projector-flicker
  wash, the context/question stamp in like a case file, then snap back to full color as the
  +2 dice rain in for the reroll. A genuine tonal cut, brief.

### Ambient presence & turns
- **Whose turn:** the active player's sheet lifts forward with a warm spotlight; others
  recede slightly. Clear, not subtle.
- **Presence dots:** green = live (a faint pulse), grey = away. Cheap, persistent, calm.
- **X-Card / safety:** the deliberate exception to all of the above. When raised, **all
  spectacle instantly stops** — motion freezes, a calm neutral overlay appears, color drains
  to quiet. Safety is the one place the UI goes *serious and still.* (See §8.)

---

## 7. Motion system (how to build it without chaos)

- **React + Motion** (Framer Motion) for orchestration; reserve heavy particle bursts
  (gore spray, explosions) for canvas/WebGL or pre-baked sprite sheets so the DOM stays
  cheap. Dice physics: a lightweight 2D physics pass or canned, varied animation curves —
  true rigid-body sim is optional, the *feel* of weight is what matters.
- **Timing vocabulary:** snappy and punchy, never floaty. Impacts use fast-in/slow-settle
  easing. Big beats (crit, death) earn a brief slow-mo hold; everything else is quick so
  play stays *hot* (the book insists on pace — no dawdling).
- **Stagger, don't pile:** the roll and allocation read as choreographed sequences with
  `animation-delay`/Motion `staggerChildren`, not a simultaneous mush.
- **Sound is part of the spectacle** (optional, muteable, default-on-with-first-interaction
  per browser policy): dice clatter, the roll concussion, wet impacts for gore, a gulp for
  feeding, stamp thunks, a projector whir for flashbacks. Keep a master mute in the safety/
  settings bar. Sound dramatically amplifies "over the top" for near-zero layout cost.
- **Performance budget:** target a phone. Cap concurrent particles, prefer transform/opacity
  animations (GPU-friendly), and make the reduce-effects path genuinely lightweight, not
  just slower.

---

## 8. Where the style deliberately stops

Two zones stay calm and serious — this contrast is itself part of the design:

1. **Safety tooling** (X-Card, Traffic Light, Lines & Veils, calibration). Plain, neutral,
   instantly legible, never jokey, never gory. Raising the X-Card *halts* the spectacle.
   This is non-negotiable and matches the rulebook's serious framing of safety.
2. **Content guardrails** (RULES.md §13): the violence is cartoon-arterial spectacle aimed
   at nazis; it is never realistic, intimate, or aimed at real social/ethnic groups. No
   slurs, no nazi iconography played straight, Hitler gets no voice. The gore is the
   *Kill Bill* register, not horror realism. Keep spatter stylized (flat crimson shapes,
   comic bursts), not photographic.

---

## 9. Quick build cues (for the frontend workstream, CLAUDE.md §5 step 6)

- Establish the CSS variables (§2), the three type voices (§3), and the paper-panel +
  grain substrate (§4) **first**, as a small style kit — before any screen. Everything
  inherits from it.
- Build the **dice components** (§5) early and lovingly; they're the soul of the app and get
  reused everywhere.
- Build the **resolution theater** (§6 roll + allocation) as the showcase screen; it's where
  the aesthetic either lands or doesn't.
- Wire the **reduce-effects** toggle and `prefers-reduced-motion` from the start, so every
  effect is added behind it rather than retrofitted.
- Keep the calm/hot split honest: if you're tempted to animate the dossier chrome
  ambiently, stop — spend that motion budget on the next hit, crit, or feed instead.
