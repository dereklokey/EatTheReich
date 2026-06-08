# Special-rules framework

> Most of *Eat the Reich* runs on one predictable loop (build pool → roll → discard →
> allocate → injury → reinforce). A minority of enemy rules, character powers, items, and
> objectives **step outside that loop**. This document is the map of those exceptions: a
> single place that says, for each one, **where in the flow it fires** and **how the table
> resolves it**. The machine-readable twin is [`src/data/specialHooks.ts`](src/data/specialHooks.ts),
> asserted complete by [`specialHooks.test.ts`](src/data/__tests__/specialHooks.test.ts).
>
> This is the **framework**, not the implementations. Each unbuilt special has its own
> tracking issue; the per-special logic — and the final call on exactly how it applies —
> lands there. The audit that spawned this is **#14**; data-vs-wired status is in
> [`RULEBOOK_NOTES.md`](RULEBOOK_NOTES.md).

---

## 1. Hook points — *when* a special can fire

The seven moments in the resolution flow where a special circumstance can attach. They
follow the RULES §4 turn machine plus the round boundary.

| Hook | When | Owning code site |
|---|---|---|
| `DECLARE` | turn declared (stat / tags / targets), before pools | `handler.ts start_turn`; reducer `TURN_STARTED` |
| `BUILD_POOL` | player & GM pools assembled | `engine/playerPool.ts`, `engine/gmPool.ts`; `handler.ts roll`/`roll_gm` |
| `ROLL_RESULTS` | rolled + successes counted, before/at discard — **the passive window** | `engine/passives.ts`, `engine/dice.ts`; `handler.ts resolve_discard` |
| `ALLOCATE` | the allocation screen (crit SPECIALs, Feed gating, target picks) | `engine/allocate.ts`, `engine/specials.ts`; `handler.ts allocate` |
| `INJURY` | injury-check reveal + reactive-gear window | `engine/injury.ts`; `handler.ts roll_injury`/`resolve_injury` |
| `TURN_END` | action concluded (reduce-to-0 triggers, GM whiff) | `handler.ts commit`/`resolve_injury`; reducer `ALLOCATION_COMMITTED` |
| `ROUND_END` | end of round / reinforcements | `engine/reinforcements.ts`; `handler.ts end_round` |

`HOOK_POINT_INFO` in the module carries the same table for the UI to render.

---

## 2. Resolution — *how* it gets applied

Two orthogonal axes. **Actor** = who drives it; **resolution** = what input it needs.

**Actor:** `system` (engine, no human) · `gm` · `player` (the acting vampire).

**Resolution:**
- **`auto`** — the engine applies an editable, logged default; nothing to click. The
  `grantsBlood` / Corpse Eater pattern. ("Suggest, don't enforce": the GM can still edit
  the resulting event — CLAUDE.md §0.)
- **`acknowledge`** — a human taps to apply/confirm; no data entry. ("Apply Rending Claws?")
- **`select`** — a human picks a target or value first (which Threat? which injury box?).
- **`message`** — informational only; the table sees that something happened (or why an
  option is disabled), with nothing to apply.

A special is a `(hook, actor, resolution, target?)` tuple. e.g. Apex Predator =
`(ALLOCATE, player, select, threat)`; Feed on Fear = `(TURN_END, system, auto, blood)`;
Bloodless = `(ALLOCATE, system, message)`.

These are **provisional starting points** in the catalog — each issue makes the final call
(the same effect could be auto-applied, GM-prompted, or player-selected depending on table
feel).

---

## 3. The catalog

`✅` implemented · `⬜` planned (issue linked). Source: `src/data/specialHooks.ts`.

### Enemy special rules
| Rule | Enemy | Hook | Resolution | Status |
|---|---|---|---|---|
| Solo / no reinforce | Sniper, Tank, … | `ROUND_END` | auto / system | ✅ |
| Powering up | Stahlsoldat | `ROUND_END` | auto / system | ✅ |
| Aura of Misfortune | Rust-Witch | `ROLL_RESULTS` | auto / system | ✅ |
| Rust Curse | Rust-Witch | `ROUND_END` | select / gm | ✅ |
| Painless | Einherjar | `ROLL_RESULTS` | auto / system | ✅ |
| Bloodless | Einherjar | `ALLOCATE` | message / system | ✅ |
| Anathema | Vampirjäger | `ROLL_RESULTS` | auto / system | ✅ |
| Rapid Deployment | Paratrooper | `ROUND_END` | auto / system | ✅ |
| Crash & Burn | Motorcycle | `ALLOCATE` | select / player | ✅ |
| Rending Claws | Werhund | `INJURY` | acknowledge / gm | ✅ |
| Unlowerable Challenge | Werhund | `ALLOCATE` | message / system | ✅ |

### Character SPECIALs (crit-allocated)
| Power | Who | Hook | Resolution | Status |
|---|---|---|---|---|
| Ravenous (+3 Blood) | Flint | `ALLOCATE` | auto / player | ✅ |
| Deadeye Shot / Back-Pocket Hex (−1 Atk) | Iryna, Cosgrave | `ALLOCATE` | select / player | ✅ |
| Apex Predator (−3 rating) | Astrid | `ALLOCATE` | select / player | ✅ |
| Unnatural Endurance (−3 GM dice) | Astrid | `ALLOCATE` | acknowledge / player | ✅ |
| Sapper (−1 Challenge) | Nicole | `ALLOCATE` | select / player | ⬜ #29 |
| Elbow Grease (−4 rating) | Chuck | `ALLOCATE` | auto / player | ⬜ #30 |
| Nightmare Regeneration (clear Injury) | Astrid | `ALLOCATE` | select / player | ⬜ #31 |
| Scavenger (restore weapon) | Nicole | `ALLOCATE` | auto / system | ⬜ #32 |

### Character passives & no-die actives
| Power | Who | Hook | Resolution | Status |
|---|---|---|---|---|
| Corpse Eater | Chuck | `ROLL_RESULTS` | auto / system | ✅ |
| Dead Man's Luck | Cosgrave | `ROLL_RESULTS` | auto / system | ✅ |
| Bone Armour | Flint | `ROLL_RESULTS` | auto / system | ✅ |
| Feed on Fear (+3 on reduce-to-0) | Nicole | `TURN_END` | auto / system | ⬜ #33 |
| Corrosive Fluids (−2 on Injury) | Chuck | `INJURY` | select / player | ⬜ #34 |
| Tethered Phantom / Hellish Screech (−1 Challenge) | Astrid, Flint | `DECLARE` | select / player | ⬜ #35 |

### Cross-turn stances & objectives
| Rule | Who | Hook | Resolution | Status |
|---|---|---|---|---|
| Mantle / Enervation / Hell's Ravenous Fire | Iryna | `DECLARE` | auto / player | ⬜ #36 |
| Secondary-objective reward menu | — | `TURN_END` | select / gm | ⬜ #37 |
| Downed → rescue Secondary Objective | — | `INJURY` | select / gm | ⬜ #16 |

### Reactive economy items
| Item | Who | Hook | Resolution | Status |
|---|---|---|---|---|
| Cigarettes (+2 Blood) | Iryna | `ALLOCATE` | auto / player | ✅ |
| Cowboy hat (ignore Injury) | Chuck | `INJURY` | acknowledge / player | ✅ |

---

## 4. Adding a new special

1. Add the rule's data to its catalog (`threats.ts` `rules` tag, a `Power`, an `Equipment`).
2. **Add a `SpecialHook` entry to `src/data/specialHooks.ts`** with the provisional
   `(hook, actor, resolution, target)` and either `status: "planned"` + `issue`, or
   `status: "implemented"`. The coverage tests fail until you do — that's the point.
3. When you build it, wire the logic at the hook's owning code site (table above), emit the
   effect as a **logged, GM-overridable event** (never a silent mutation), and flip the
   entry to `implemented` (dropping its `issue`).
