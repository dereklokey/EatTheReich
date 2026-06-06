# RULES.md — Eat the Reich, as implemented

> The game-logic contract for the companion app's engine. This is the source of truth for
> dice math, state transitions, and the character/enemy catalog. It describes the *Havoc
> Engine* rules **as the app implements them**, written for engineers — not a reproduction
> of the rulebook. Build the engine to satisfy this; assert the golden tests in §12 against it.
>
> Companion file: `CLAUDE.md` covers architecture, stack, UI, and build order, and defers to
> this file for all rules. Overriding principle from `CLAUDE.md` applies here too: **every
> number the engine computes is a default a human can override before it commits.**

---

## 1. Core loop

1. GM frames a **scene**: one or more **Objectives** and any **Threats** in play.
2. GM chooses which player acts next (any order).
3. That player takes one **turn** = one **action** = one **roll** (§4).
4. Repeat until every player has acted once → **end of round**.
5. End of round: apply **Reinforcements** (§8).
6. An Objective at rating 0 is **complete**; completing the scene's Objective ends the
   scene (unless other Objectives remain). The player who removed the last point narrates.

The game is deliberately loose ("imprecise, over-the-top"). The engine assists and tracks;
it never blocks a human decision.

---

## 2. Stats

Seven stats, each character-rated: **BRAWL, CON, FIX, SEARCH, SHOOT, SNEAK, TERRIFY**.
An action uses exactly one stat; its rating = base dice. If no stat fits, the action rolls
a flat **2 dice**.

---

## 3. Objectives vs Threats

Everything in play is mechanically one or the other.

**Objective** — a goal. Has `rating` (2–12) and optional `challenge`. Reduced by allocating
successes. Rating 0 = complete. **Never rolls anything at the player; never deals damage.**

**Threat** — an enemy. Has `rating` (reduce to 0 to defeat) **and** `attack` (the GM's
dice pool), plus optional `challenge`. The Attack rating is the *only* thing that makes a
Threat dangerous rather than just another target.

**Critical: `rating` and `attack` are independent.** Reducing a Threat's rating does NOT
lower its Attack. Attack only changes when (a) something explicitly reduces Attack (an
ability/SPECIAL/secondary-objective reward), or (b) rating hits 0, at which point Attack is
set to 0 too (defeated — no longer deals damage, but may reinforce, §8).

**Engagement.** The GM's pool exists only because of *engaged* Threats. Engagement is
**per-action**: when a player acts, the GM rolls dice = the **highest Attack among the
Threats engaged with this action, +1 per additional Threat in play.** If no Threat is
engaged, **the GM rolls zero dice and the player cannot be injured this turn.** This is how
the system models stealth/safety: an unaware or unengaged enemy contributes no Attack dice.
(See §4 BUILD_GM_POOL and §11 for the stealth pattern.)

**One Threat vs many.** A group (e.g. a squad) may be modeled by the GM as a *single*
Threat (one rating, one Attack) or as *several* separate Threats. The "+1 per additional
Threat" rule only bites in the second case. Engine implication: Threats are a list; the GM
pool is derived as `max(attack of engaged) + (count of all threats in play − 1)` — see §4.

Players may split successes across any Objectives and Threats in play, as fiction allows.

---

## 4. The turn (resolution state machine)

One action per turn, **one player roll per turn** (the only in-turn reroll is Flashback,
§9, which *replaces* the roll). Model as explicit phases:

```
DECLARE → BUILD_PLAYER_POOL → BUILD_GM_POOL → ROLL
→ PRE_DISCARD_HOOKS → DISCARD → ALLOCATE → POST_ALLOCATE → INJURY_CHECK → DONE
```

**DECLARE** — player narrates the action, picks the **stat**, and selects which **Threat(s)**
(if any) this action is engaged with.

**BUILD_PLAYER_POOL** — pool = stat rating, then add:
- `+1` per **equipment** item used (spends 1 use of that item).
- `+1` per **ability** used (pay its Blood cost; some abilities add no die — read each).
- `+N` **bonus dice** per satisfied **bonus requirement** on used gear/abilities, where N =
  number of `+` symbols (`+`=1 … `++++`=4). "Satisfied" is a GM-confirmed toggle driven by
  the player's narration. (Some powerful items have few uses but large bonus dice, e.g. a
  1-use item granting +4.)
- **Go Out With A Bang**: if this is the *last* use of an item that *started* with >1 use,
  add **+1** additional bonus die.
- Pool is **not frozen at roll time**: more bonus dice may be rolled **during ALLOCATE** as
  new narrated details satisfy new requirements (§ allocate). Support adding dice mid-allocation.
- Player may narrate gear/abilities *without* paying → no die ("narrative only").

**BUILD_GM_POOL** — `max(Attack of engaged Threats) + (totalThreatsInPlay − 1)`. With one
engaged Threat and no others, that's just its Attack. With no engaged Threat, **0**.
GM-overridable. (Worked example: Infantry Squad killed, only Police Patrol Attack 2 left →
GM rolls 2; if the Squad were still in play the objective roll would face 4 = Squad's
attack(3) +1 for the extra Threat. See §12.)

**ROLL** — server rolls both pools; raw results broadcast to all (the shared dice spectacle).

**PRE_DISCARD_HOOKS** — passives that read the **raw** dice fire here, *before* discard:
- Gain-on-1s passives (Chuck's Corpse Eater: +1 Blood if any 1 rolled).
- Reduce-GM-successes-per-1 passives (Cosgrave Dead Man's Luck, Flint Bone Armour: −1 GM
  *successful* Attack die per 1 the player rolled — requires GM successes already known;
  see ordering in §5).

**DISCARD** — discard all player dice showing **≤3**. Survivors: **4–5 = success (1 unit)**,
**6 = critical (2 units, can activate a SPECIAL)**. The discard threshold is **per-engagement
overridable** (Rust-Witch raises it: players discard **≤4**, so only 5–6 survive).
GM dice have **no crit rule** — a GM die ≥4 is one success; a GM 6 is just one success.

**ALLOCATE** — assign each surviving die to exactly one target. Success = 1 unit; crit = 2
units (or one SPECIAL). Each allocation carries an optional one-line narrated detail; a
detail that newly satisfies a requirement may unlock more bonus dice rolled *now*. Targets:
- **Advance Objective**: −1 rating (−2 crit). Challenge absorbs first (§6).
- **Eliminate Threat**: −1 rating (−2 crit). Challenge absorbs first. Rating 0 → Attack 0.
- **Defend**: remove **1** GM Attack die (2 for crit). **This is the only way GM dice get
  cancelled — a per-die player choice, not automatic.**
- **Feed**: +1 Blood (+2 crit). Cap 10.
- **Activate SPECIAL**: **criticals only** (§7).

**POST_ALLOCATE** — apply effects; recompute remaining GM Attack dice.

**INJURY_CHECK** — using GM Attack dice left after defense (player has no dice left):
- **0 leftover** → no Injury.
- **1–2 leftover** → mark **one** Injury (§5).
- **3+ leftover** → **Downed** (§5).

**DONE** — advance the turn pointer; if all players have acted → end of round (§8).

---

## 5. Injuries, Downed, Death, Healing, Blood

### Injury track
Each character has a unique track: **3 categories × 2 boxes = 6 total**. On a normal Injury:
roll **d6 → category**; tick the **first open box** in that category; if the first is taken,
tick the second; if both are taken, mark a box in an alternate category. **Marking the
second box in a category triggers that injury's mechanical penalty** (stat mods, restricted
gear/ability use, or Blood-economy changes — per character, §10/data).

### Downed
3+ GM Attack dice remaining → roll a category and **mark all boxes in it**. The vampire is
**out of the fight** until rescued. Rescue becomes a new **Secondary Objective**, rating
~2–4 (GM sets). If not rescued before moving on, the vampire is captured.
(Some enemies escalate normal injuries to Downed-like severity — Werhund's Rending Claws
marks all boxes in the rolled category even on a non-Downed hit.)

### Death
All 6 boxes marked → **Last Stand**: roll **8d6**, allocate freely to Objectives/Threats,
narrate a final sacrifice, retire. A heal-Injury SPECIAL **cannot** be used during Last
Stand.

### Healing
Spend **3 Blood at any time** to clear one marked Injury box. Re-marking a healed injury
later reapplies the *same* mechanical penalty (re-describe in fiction).

### Ordering note (implement exactly)
1. Roll both pools.
2. Determine GM successes (GM dice ≥ that enemy's threshold; standard = ≥4).
3. Apply per-1 reduction passives to GM **successful** dice (Dead Man's Luck, Bone Armour).
4. Apply player gain-on-1 passives (Corpse Eater) — independent.
5. Discard player dice ≤ threshold.
6. Allocate; defense removes GM dice; leftover GM successes drive the Injury check.

### Blood
Per vampire, **0–10**. **All start at 0.** Gained via Feed allocation, some abilities/crits,
and effects. Spent on abilities, healing (3), some advances. **Sharing:** vampires within
arm's reach may transfer any amount freely (method is fiction).

---

## 6. Challenge

If an Objective/Threat has `challenge`, it **negates that many allocated units before its
rating drops**. Allocate 3 to a Challenge-2 target → net 1. **Challenge applies per turn,
per vampire** engaging that target (it resets; it is not a shared pool depleted across the
table). Some enemies make Challenge **unlowerable** (Werhund).

---

## 7. SPECIALs, Abilities, Advances

- **Abilities** are available from the start. Each used adds a die (unless its text says
  otherwise) and may cost Blood.
- **SPECIALs** are rule-breaking effects. A SPECIAL fires **only when a critical is
  allocated to it** — *unless* its text gives a different trigger/condition (e.g. "when in
  melee", or Nicole's Scavenger). Tag each SPECIAL with `trigger: 'crit' | 'condition'` and,
  where relevant, a `condition` the engine/GM checks before offering it (e.g. Chuck's Elbow
  Grease only appears as a crit-target on a **solo FIX Objective** action).
- **Advances** are **locked** until the player **drinks Übermensch blood**, then they unlock
  one. Character state: `unlockedAdvances: Set<id>`. Advances may grant new SPECIALs/passives.

---

## 8. Reinforcements (end of round)

Standard:
1. Any Threat reduced to **0 this round**: restore rating by **1d6**; set Attack to **half
   its starting Attack, rounded down**.
2. **Every Threat still in play: Attack +1.**
3. Any Threat the GM rolled **zero successes** against during the round: **Attack +1**
   (checked at end of round).

**Exemptions:** Übermenschen / elite operatives **do not reinforce** — at rating 0 they die
permanently and are removed (their Attack starts higher to compensate).

**Relaxed variant (table toggle):** ignore reinforcement entirely; instead bump
ratings/Attack by 1–3 as the GM sees fit; Threats at 0 are simply removed.

All reinforcement results (the 1d6, the +1s, half-Attack reset) are shown and GM-confirmable
before commit.

---

## 9. Flashbacks (requires session tracking)

**Once per session per player**, when that player rolls **≤2 successes**, they may trigger a
flashback: pick/roll a **context** and a **question** (tables below), narrate a brief past
F.A.N.G. scene, then **add 2 dice and reroll the entire pool — the second result stands.**
Track `flashbackUsedThisSession` per player; reset on `SESSION_STARTED`.

Flashback is a **reroll/replacement** of the same action, not a second action.

**Contexts (d6):** 1 plummeting aeroplane · 2 rescuing P.O.W.s in a thunderstorm ·
3 assassinating a general at the opera · 4 extracting a spy behind enemy lines ·
5 stealing a cypher machine from a submarine · 6 sabotaging a field gun with explosives.
(Matching another player's roll = same mission.)

**Questions (d6), `[character]` = a present PC, randomly chosen or picked:**
1 You saved [c] from certain death — what nearly killed them? ·
2 You recruited [c] to F.A.N.G. — what did it take? ·
3 You owe [c] your life — how did they save it? ·
4 [c] taught you tricks — most important lesson? ·
5 Won't let [c] see you fail — what do you respect most about them? ·
6 Won't let [c] see you fail — what do they most respect about you?

---

## 10. Characters (rules-data summary)

Six fixed pregens. Full verbatim stat blocks → typed data files (`data/characters.ts`);
this section captures rules that need engine hooks. Per character, state tracks: current
Blood, per-item uses remaining, injuries marked (and triggered penalties), unlocked
advances, active loot slot.

- **Iryna** — ranged occultist. SPECIALs reduce Threat Attack / inflict flat Übermensch
  damage (advance-gated). Example gear: Exquisite Hunting Rifle (+elevated position),
  Explosive Runes (++concealed).
- **Nicole** — demolitions. **Scavenger** SPECIAL: roll d6, match the `[n]` bracket on her
  weapons, restore 1 use of that weapon (this is a `condition`-trigger restore, not crit).
  **Sapper**: with explosives, reduce a target's Challenge by 1. Gear carries `[1]..[6]` IDs.
- **Cosgrave** — necromancer. **Dead Man's Luck** advance = pre-discard passive (−1 GM
  successful die per rolled 1). Has a 1-use soul jar granting +4 bonus dice.
- **Chuck** — ghoul. **Corpse Eater** passive: +1 Blood on any rolled 1 (pre-discard).
  **Elbow Grease** advance SPECIAL: on a **solo FIX Objective** action, a crit reduces that
  Objective's rating by **4** (condition-gated *and* crit-gated). Cowboy hat: one-time
  ignore an Injury/Downed, hat destroyed.
- **Astrid** — predator. SPECIALs e.g. **Apex Predator** (−3 Threat rating), **Unnatural
  Endurance** (−3 GM Attack dice), **Nightmare Regeneration** advance (clear an Injury).
- **Flint** — bat-monster. **Bone Armour** advance = pre-discard passive (as Dead Man's
  Luck). **Ravenous** SPECIAL (melee: +3 Blood). **Wings** (flight/aerial).

---

## 11. Patterns the engine must support (from common play situations)

- **Safe stealth:** action with **no engaged Threat** → GM rolls 0 → allocate to Objective
  with no Injury risk. The danger only "turns on" when a Threat becomes engaged.
- **Guarded-but-not-fighting:** model as an Objective with a **Challenge** (soaks successes)
  rather than a Threat (which would roll damage). Represents "hard to do quietly," not
  "fights back."
- **Stealth breaking:** a poor stealth roll is resolved as its own turn (GM rolled 0 if no
  Threat was engaged). Its *consequence* — "the guard spots you" — is a **GM state change
  that promotes a Threat to engaged for future turns**, optionally with a one-off GM-applied
  "free Attack." It is **not** a second player roll in the same turn. Engine: provide a GM
  control to flip a Threat to engaged mid-scene, decoupled from the player's roll.
- **Engaging multiple Threats** in one action: GM pool = highest engaged Attack + 1 per
  additional Threat in play (§4).
- **Use-restore** (Scavenger, Ammunition Depot "restore all firearms"): model as a distinct
  restore event, not merely a counter you can only decrement.
- **Loot active-slot:** a character may hold multiple loot items; **exactly one loot-slot
  item is mechanically active** at a time (free to switch). Starter equipment and slot-free
  special gear are *not* subject to this and may be combined freely in a turn alongside the
  one active loot item.

---

## 12. Golden tests (encode against the engine)

**A — Iryna clock-tower turn.**
Objective "Take cover inside the museum" rating 6; Threat "nazi squad" rating 4, **Attack 3**.
Player pool 6 = SHOOT 3 + rifle(1) + runes(1) + (+elevated) bonus(1). GM pool 3.
Rolls: player `6,5,4,2,2,1`; GM `6,4,1`. Discard ≤3 → player `6,5,4`; GM successes `6,4`.
Allocate: 4 → Objective (6→5); 5 → Objective (5→4); 6 (crit) → Defend (removes 2 GM dice →
GM Attack 0). Mid-allocation, Explosive Runes (++concealed) now satisfied → roll 2 bonus
dice `4,2`, discard the 2; allocate the 4 → Objective (4→3). GM Attack 0 → **no Injury**.

**B — Reinforcements.**
In play: Infantry Squad (rating 6, Attack 3) + Police Patrol (rating 4, Attack 2). This
round Astrid deals 4 and Chuck deals 2 to the Squad → Squad rating 0.
- A later objective roll that round: since the Squad is at 0, GM rolls **2** (Police Patrol
  Attack), *not* 3. Had the Squad still been alive, the objective roll would face **4** =
  Squad Attack 3 + 1 for the extra Threat.
- End of round: Police Patrol Attack → 3 (closing in, +1). Infantry Squad regains **1d6**
  rating; new Attack = floor(3/2) = **1**.

**C — Challenge.** Allocate 4 successes to a Challenge-1 Objective → net **3** rating
reduction. Per vampire, per turn (next vampire's allocation faces the full Challenge again).

**D — Downed vs Injury.** 2 GM dice left after defense → one Injury (roll category, tick a
box). 3 GM dice left → Downed (roll category, mark **all** its boxes; spawn rescue Secondary
Objective rating 2–4).

**E — SPECIAL gating.** Chuck's Elbow Grease is offered as a crit-target **only** when the
action is a solo FIX Objective; otherwise it never appears, and his crits behave normally.

---

## 13. Tone & content guardrails (apply to any generated copy)

Gleeful, vulgar, over-the-top anti-fascist pulp; violence is spectacle, not intimate.
**Hitler gets no voice/monologue. No slurs and no acted-out nazi gestures in generated
content.** Übermenschen are the GM's "speaking" villains and are written to avoid the
literal nazi-ideology bit (Dämonenblut = hedonistic killer; Rust-Witch = chaos-maddened;
Stahlsoldat = unfeeling machine; Werhund = frantic beast). Safety-tooling copy stays plain
and serious — never jokey.
