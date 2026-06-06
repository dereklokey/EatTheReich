# Eat the Reich — Companion App

A realtime, multiplayer companion app for the tabletop RPG **Eat the Reich**
(Grant Howitt / Will Kirkby, Rowan Rook & Decard — *Havoc Engine*). One GM, up to
six vampire players, played remotely in bursts over weeks. Shared game-state board
+ dice engine + resolution "theater". It **assists and tracks; it never referees** —
every computed value is a default the GM can override (*suggest, don't enforce*).

> **Read the three contracts before changing code:**
> [`CLAUDE.md`](./CLAUDE.md) (architecture/build) ·
> [`RULES.md`](./RULES.md) (game-logic — source of truth) ·
> [`DESIGN.md`](./DESIGN.md) (visual & motion).

## Status

Roadmap (CLAUDE.md §5). The pure, offline-testable core is in place — **no
Cloudflare yet, nothing deployed, $0**.

| Step | Area | State |
| --- | --- | --- |
| 1 | Data layer (characters, threats, locations, flashbacks) | ✅ fully transcribed from the rulebook |
| 2 | Pure engine + golden tests | ✅ RULES §12 A–E pass; verified vs rulebook |
| 3 | Event store + reducer + snapshots | ⏳ next |
| 4 | Durable Object room (Cloudflare) | ⏳ |
| 5 | Seats, sessions, presence | ⏳ |
| 6 | Frontend (React/Vite/Tailwind, per DESIGN.md) | ⏳ |
| 7 | Safety tooling | ⏳ |
| 8 | Polish | ⏳ |

## Layout

```
src/
  domain/      types, dice roller, character shapes (pure data contracts)
  engine/      the turn pipeline as pure functions over (state, dice)
    gmPool · playerPool · dice (discard/successes) · passives ·
    allocate (challenge/defend/feed) · injury · reinforcements · specials
    __tests__/golden.test.ts   RULES §12 A–E — the correctness contract
    __tests__/units.test.ts    supporting coverage
  data/        characters.ts · threats.ts · locations.ts · flashbacks.ts · rewards.ts
    __tests__/catalog.test.ts  catalog integrity + reinforcement variants
```

The engine is intentionally Cloudflare-free: it's `reduce`-able pure functions so it
can be proven offline before the Durable Object (step 4) ever exists.

## Develop

```bash
npm install
npm test          # vitest run — golden + unit tests
npm run test:watch
npm run typecheck # tsc --noEmit, strict
```

## Rulebook as source of truth

All character and enemy data is transcribed from the printed rulebook (kept locally
in `reference/`, gitignored). Where the book and `RULES.md` disagree, the **book
wins** and the divergence is logged in [`RULEBOOK_NOTES.md`](./RULEBOOK_NOTES.md) —
e.g. Nicole's Scavenger is a crit SPECIAL (not a non-crit trigger), and the
Stahlsoldat has a hybrid reinforcement. That file also lists special enemy rules
(Painless, Anathema, Rending Claws, …) captured as data but not yet wired into the
engine.

## Cost

Free-tier by design (CLAUDE.md §3.7). Nothing here touches Cloudflare yet; when the
Durable Object lands it runs on the Workers Free plan with hibernation → **$0** for a
GM + a few friends. Deploys are never run without explicit sign-off.
