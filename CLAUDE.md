# CLAUDE.md — Eat the Reich Companion App

> A realtime, multiplayer companion app for the tabletop RPG **Eat the Reich**
> (Grant Howitt / Will Kirkby, Rowan Rook & Decard, 2023; built on the *Havoc Engine*).
> **This file is the build spec (architecture, stack, UI surfaces, roadmap). `RULES.md` is
> the game-logic contract. `DESIGN.md` is the visual style & interaction-feel contract.
> Read all three before writing code.**

---

## 0. What this app is (and isn't)

**Is:** a shared game-state surface + dice engine for a group playing Eat the Reich
remotely. One GM, up to six vampire players. Everyone sees the board (objectives,
threats, blood, progress). Each player drives only their own character sheet. Dice
resolution is a guided, visible, group spectacle.

**Isn't:** a rules-enforcing straitjacket, a VTT with maps/minis, or a character
*builder*. Characters are the six fixed pregens. Maps are narrative, handled by the GM
in voice/text elsewhere.

### Guiding principle: **suggest, don't enforce**
Eat the Reich explicitly tells the GM to bend or drop rules whenever it serves the
table (rulebook p45, "When not to use the rules"). Therefore:

- **Every computed value is a default the GM can override before it commits.** Pool
  size, threat dice count, reinforcement rolls, injury results — all editable.
- Overrides are themselves logged as events (see §3.2). Nothing is silently mutated.
- The app's job is bookkeeping and momentum, not refereeing. When in doubt, show the
  number, let a human accept or change it.

Target automation level: between "assisted" and "lightweight." The app tracks state,
computes suggestions, and walks the table through the resolution sequence — but a human
always confirms each commit and can edit anything.

---

## 1. The rules live in RULES.md

**`RULES.md` is the game-logic contract — the single source of truth for the dice math,
the turn state machine, the character/enemy catalog, and the golden tests.** This file
(`CLAUDE.md`) is build direction only and does not restate the rules. Both files must be
present in the project.

When building the engine, implement against `RULES.md` and assert its §12 golden tests.
Quick pointers you'll reference often from here:

- **Turn resolution state machine** → RULES.md §4
  (`DECLARE → BUILD_PLAYER_POOL → BUILD_GM_POOL → ROLL → PRE_DISCARD_HOOKS → DISCARD →
  ALLOCATE → POST_ALLOCATE → INJURY_CHECK → DONE`).
- **Objectives vs Threats; rating/Attack independence; engagement** → RULES.md §3.
- **Allocation targets** (Advance / Eliminate / Defend / Feed / SPECIAL) → RULES.md §4 ALLOCATE.
- **Injuries / Downed / Death / Healing / Blood; passive ordering** → RULES.md §5.
- **Challenge** → RULES.md §6 · **SPECIALs/Abilities/Advances** → RULES.md §7 ·
  **Reinforcements** → RULES.md §8 · **Flashbacks + session reset** → RULES.md §9 ·
  **Characters** → RULES.md §10 · **Engine patterns** (stealth, use-restore, loot
  active-slot) → RULES.md §11.

The "suggest, don't enforce" principle in §0 is the one rules-adjacent thing that lives
*here*, because it's about how the app should behave, not what the rules say.

---

## 2. Safety tooling (first-class feature, not optional)

The rulebook front-loads safety (Lines & Veils, X-Card, Traffic Light). Build these in:

- **Session 0 panel**: collect **Lines** (never appear) and **Veils** (no detail), plus
  the **Evil Calibration Checklist** (four tiers, p68) the table can adjust. Stored on
  the game, visible to all.
- **X-Card**: a persistent button for *every* participant (GM included). Pressing it
  **immediately broadcasts a pause overlay to all clients** — no reason required,
  anonymous option. The presser can then type the change they want.
- **Traffic Light**: RED / AMBER / GREEN quick-signal buttons, broadcast to all.
- These must work mid-resolution and never be more than one tap away.

---

## 3. Architecture

### 3.1 Shape: server-authoritative, event-sourced

- **Server owns all state and rolls all dice.** Clients send **intents**; the server
  validates against current state, computes results (rolls included), appends an
  **event**, and broadcasts the new state (or the event + reduced state) to the room.
  This prevents client-side dice fudging and keeps every screen consistent.
- **Event sourcing**: state = `reduce(events, initialState)`. Every mutation is an
  appended, immutable event. This buys, almost for free:
  - **Undo / "GM rewind"** (pop/negate events) — essential given the override-heavy,
    "we'll bend the rule" play style.
  - **Resumability across weeks** — reload a game by replaying its event log.
  - **Session boundaries** — a `SESSION_STARTED` / `SESSION_ENDED` event; flashback flags
    reset on session start.
  - **Replay / audit / spectating**.
- Keep a **snapshot** every N events so long games don't replay thousands of events on
  load.

### 3.2 Event taxonomy (non-exhaustive)

```
GAME_CREATED, PLAYER_JOINED, ROLE_CLAIMED(seat, seatToken), SEAT_RELEASED(seat),
SESSION_STARTED, SESSION_ENDED,   // SESSION_STARTED resets per-session flags (flashbacks)
SAFETY_SET(lines,veils,calibration), XCARD_RAISED, TRAFFIC_SIGNAL(color),
SCENE_FRAMED, OBJECTIVE_ADDED/UPDATED/COMPLETED,
THREAT_ADDED/UPDATED/REMOVED,
TURN_STARTED(playerId), POOL_BUILT(player|gm, dice, sources),
DICE_ROLLED(player|gm, results),               // server-generated randomness
PASSIVE_APPLIED, DICE_DISCARDED,
DIE_ALLOCATED(target, amount, detail), ALLOCATION_COMMITTED,
INJURY_MARKED(category, boxes), DOWNED, HEALED, DEATH_LAST_STAND,
BLOOD_CHANGED(playerId, delta, reason), BLOOD_SHARED(from,to,amount),
EQUIPMENT_USED(itemId), LOOT_ADDED(item), LOOT_ACTIVATED(slot),
ADVANCE_UNLOCKED(playerId, advanceId),
SECONDARY_OBJECTIVE_ADDED/COMPLETED(rewardChoice),
FLASHBACK_TRIGGERED(playerId, context, question),
ROUND_ENDED, REINFORCEMENTS_APPLIED(details),
GM_OVERRIDE(targetEvent, patch)                // explicit override, always logged
```

Every event carries `{id, gameId, actor, ts, type, payload}`.

**Not events**: `HEARTBEAT` and presence/online-status broadcasts are **transient** —
never appended to the log (they'd bloat it and they're meaningless to replay). Handle
them as in-memory DO state + a plain broadcast; they rebuild naturally as clients resume
heartbeating after a wake. See §3A.

### 3.3 Realtime + persistence layers (behind interfaces)

Define two interfaces so the stack can be swapped later if ever needed:

```
interface Realtime { joinRoom(gameId, conn); broadcast(gameId, msg); }
interface Store { appendEvent(gameId, e); loadEvents(gameId); saveSnapshot(...); loadSnapshot(...); }
```

**Authority model**: clients never mutate state directly. Flow is
`client intent → server validate+roll+reduce → append event → broadcast`.

### 3.4 Primary stack: Cloudflare (one Durable Object per game room)

This is purpose-built for "one game = one room, played in bursts over weeks." Cost for a
single GM + a few friends is **$0** — comfortably inside the free tier (see §3.7).

- **Frontend**: React + Vite, static build, deployed to **Cloudflare Pages** (free).
  Tailwind for speed. A single client-side reducer mirrors server state.
- **Room = one Durable Object**: the game ID names the DO (`env.GAME.idFromName(gameId)`).
  That one object instance holds the live state for that game in memory and terminates
  **all** websockets for that room. This is the whole "realtime + coordination" layer —
  no separate server, no separate pub/sub.
- **WebSockets via the Hibernation API** — important, not optional:
  - Use `state.acceptWebSocket(ws)` (hibernatable accept), NOT the plain
    `ws.accept()`. Plain accept pins the object in memory and **incurs duration charges
    the entire time a socket is connected**. Hibernatable accept lets the runtime sleep
    the object during inactivity while keeping clients connected → near-zero cost between
    bursts of play.
  - Implement `webSocketMessage(ws, msg)`, `webSocketClose(...)`, `webSocketError(...)`
    handlers on the DO class (the hibernation handler style), not an in-closure
    `addEventListener` loop.
  - **In-memory state is discarded on hibernation.** Therefore the DO must be able to
    rebuild current state purely from storage on wake (the constructor re-runs). This is
    exactly why we event-source (§3.1): on wake, load latest snapshot + replay events
    since it.
- **Persistence = the DO's own storage** (SQLite-backed Durable Object storage):
  - `events` keyed `evt:<gameId>:<seq>` (append-only), plus a `meta` record with the
    current sequence number, and periodic `snapshot:<gameId>:<seq>` records.
  - `better-sqlite3` does NOT run on Workers — do not use it here. Use the DO storage
    API (`ctx.storage.sql` / `ctx.storage.put/get/list`).
  - Optional later: copy snapshots to **R2** for cold archival/export. Not needed for v1;
    the event log is tiny (text).
- **Routing**: a small Worker (or Pages Function) takes the websocket-upgrade request for
  `/game/:id`, resolves the DO by name, and forwards. Everything else is static Pages.

### 3.5 Why this over an always-on Node server

An always-on VM (e.g. Fly.io + `ws` + better-sqlite3) is a fine, more familiar model and
remains a clean fallback **because the §3.3 interfaces isolate the swap**. We chose
Cloudflare as primary because: (a) the "one room = one DO" mapping is a natural fit for
this app; (b) hibernation makes idle weeks genuinely free rather than "cheap"; (c) the
event-sourced design already requires rebuild-from-storage, which is exactly what
hibernation demands — so we get resilience for free. The cost is one new concept (the DO
model); the §5 roadmap builds the pure engine first so that concept only shows up late.

### 3.6 Identity, rooms & seats

- A **game** = a DO room named by a short, hard-to-guess **join code** (the code IS the
  access key, so use enough entropy from a non-ambiguous alphabet; no accounts/passwords).
- **Create game** → server mints a code, creates the DO, writes `GAME_CREATED`.
  **Join game** → client sends the code, connects to that DO.
- **Seat model** (this is the "how does Dave get to be Iryna again in week two" answer):
  - On first claim, server writes `ROLE_CLAIMED{seat, seatToken}` and returns the
    **seatToken** to that client, stored in `localStorage` keyed by gameId. The token is
    the durable proof of "this device owns this seat."
  - On return, the client presents `{gameId, seatToken}` and is **auto-seated** into its
    old character/GM seat — no re-pick.
  - **Fallback for lost tokens** (cleared browser, new device): any seat can be *released*
    — the GM has a "release seat" control, and a player can claim an unclaimed/released
    seat from the pick screen. So the happy path is automatic; the messy path is one GM
    click.
  - The seat-pick screen greys out **claimed** seats (regardless of online/offline) so two
    people can't hold the same character.
- **Visibility vs interaction**: the board (objectives, threats, progress, everyone's
  blood + full sheets) is visible to all. **Interaction is seat-scoped**: a player may
  only act on / spend / allocate for their own character; the GM may act on anything.

### 3.7 Cost / free-tier reality (single GM + a few friends)

- Free plan: **100,000 requests/day** and **13,000 GB-s duration/day**, reset 00:00 UTC.
- WebSocket **messages count as requests**, but **20:1** (100 msgs billed as 5 requests).
  A full multi-hour session for 6 people is a few hundred billable requests — orders of
  magnitude under the cap.
- Hibernation means **no duration billing while idle** between rolls / between weeks.
- DO storage free limit is **1 GB per object**; an event log of text is kilobytes.
- Free plan has **no overage billing** — exceeding a limit makes that operation fail
  until reset rather than charging you. At this scale you won't hit it. You only ever pay
  if you deliberately opt into Workers Paid ($5/mo), which is unnecessary here.
- **Net: $0/month** for this use case.

---

## 3A. Sessions, presence & resumption

This section makes the lifecycle in the user's mental model explicit. There is **no
"logged-in" state to log out of.** There are two independent layers:

1. **Seat ownership** — durable, survives weeks, via `seatToken` (§3.6). Closing the tab,
   clicking "exit," or vanishing for a fortnight does NOT unclaim your seat. Your
   character stays yours.
2. **Presence** — ephemeral "who's here right now," driven by heartbeats, NOT by whether a
   socket looks open (a sleeping laptop's socket state is unreliable, and hibernated DOs
   keep sockets nominally connected anyway).

### Presence via heartbeat

- While a tab is **open and focused**, the client sends a lightweight `HEARTBEAT` every
  **20–30s** (use ~25s). Pause heartbeats when the tab is hidden/blurred
  (`document.visibilitychange`) to avoid burning requests while no one's looking.
- Server tracks `lastSeen[seat]`. A seat is shown **online (green)** if seen within ~60s,
  else **away/offline (grey)**. This is display state only — never unclaims the seat.
- The "idle person who never clicked exit two weeks ago" simply renders grey because no
  heartbeats are arriving; when they reopen the tab, heartbeats resume and they go green.
  This satisfies the user's "auto-logout" desire without an actual logout concept.
- Heartbeats should NOT spam the event log (don't persist them as game events). Treat
  presence as transient in-memory state on the DO + a transient broadcast; it can be lost
  on hibernation and simply rebuilt as clients resume heartbeating.

### Stopping play

- Nothing to save explicitly — every game-affecting action already appended an event to DO
  storage as it happened. Tab close / "exit game" / dead battery are all equivalent and
  safe; they only drop the websocket.
- "Exit game" is just: stop heartbeating, drop the socket, return to the create/join
  screen. The seatToken remains in localStorage for next time.

### Resuming (the week-two flow)

1. Everyone hits **Join**, enters the same code.
2. The DO **wakes on the first connection**: constructor re-runs, loads latest snapshot +
   replays events since → full current state rebuilt in memory.
3. Each client presents its `seatToken` and is auto-seated; the DO pushes a full
   state snapshot to each on connect. Token-less returners re-pick (GM-release if needed).
4. Play continues from the exact prior state (blood, injuries, half-finished objective,
   round/turn pointer, per-session flashback flags).
5. **New real-world session**: the GM clicks "Start session," writing `SESSION_STARTED`,
   which resets per-session flags (notably each player's `flashbackUsedThisSession`).
   (Resuming a tab mid-session does NOT reset these — only an explicit new session does.)

### Optional room lifecycle (nice-to-have, not v1-critical)

- A **"finish & delete game"** control (GM) to tear down a completed campaign.
- Optional **auto-expiry**: a DO that hasn't seen activity in N days (e.g. 90) may
  self-clean via an Alarm. Storage is trivial, so this is hygiene, not necessity.

---

## 4. UI surfaces

> **Visual style and interaction feel are specified in `DESIGN.md`** — palette, typography,
> the dossier/spectacle split, the dice treatment, and the per-action motion brief
> ("clicks and rolls should feel like setting off a bomb"). This section lists *what
> surfaces exist*; DESIGN.md governs *how they look and feel*.

- **Board (all)**: active objectives (rating bars + challenge), threats (rating + attack
  + challenge + hooks badges), whose turn, round counter, session indicator.
- **Character sheet (own = editable, others = read-only)**: stats, blood (0–10), equipment
  with use-pips, abilities, advances (locked/unlocked), injury track (3×2), loot slots.
- **Resolution theater (all watch, active player + GM drive)**: the dice-vs-dice
  spectacle. Shows pool assembly (with each die's source), the roll, discards animating
  away, passives firing, then the allocation tray where the active player drags surviving
  dice onto targets and types a detail per die. GM-confirm gates between phases.
- **GM panel**: frame scenes, add/edit objectives & threats, load a location's suggested
  board, confirm/override every computed value, run end-of-round reinforcements (shown
  with the dice it rolled), trigger Downed rescue objectives.
- **Safety bar (all, always visible)**: X-Card, Traffic Light, link to Lines/Veils.

---

## 5. Build roadmap (suggested order)

1. **Data layer**: encode all six characters, standard threats, Übermenschen + hooks,
   flashback tables, location reference data. Pure data + types, no UI. Unit-test the
   catalog.
2. **Engine (pure, offline-testable)**: the turn state machine, pool builder, dice +
   discard + passives, allocation, challenge, injuries/downed/death, reinforcements.
   Write it as pure functions over state + event → state. **Assert the golden tests in
   RULES.md §12** (Iryna clock-tower turn, reinforcements, challenge, Downed-vs-Injury,
   SPECIAL gating) — they're drawn from the rulebook's own numbers and map straight to
   unit tests.
3. **Event store + reducer + snapshots**, offline first. Implement the `Store` interface
   against an in-memory/file stub for tests, so the engine and store are provable without
   any Cloudflare involvement.
4. **Durable Object room**: implement the DO class — hibernatable websocket accept
   (`state.acceptWebSocket`), `webSocketMessage/Close/Error` handlers, intent→validate→
   roll→event→broadcast, snapshot+replay rebuild on wake. Implement `Store` against DO
   storage. Add the upgrade-routing Worker/Pages Function for `/game/:id`.
5. **Seats, sessions & presence**: create/join + code minting, `seatToken` issue/reclaim,
   GM seat-release, `SESSION_STARTED` flag resets, heartbeat presence (transient, ~25s,
   pause when tab hidden). See §3.6 and §3A.
6. **Frontend**: create/join screen → seat-pick (greying claimed seats) → board + sheets
   read-only → resolution theater → GM panel. Client reducer mirrors server state; full
   snapshot pushed on connect. **Follow `DESIGN.md`**: build the style kit (CSS variables,
   type voices, paper substrate) and the dice components first, then the resolution theater
   as the showcase; wire the reduce-effects / `prefers-reduced-motion` path from the start.
7. **Safety tooling** (can land early — it's simple and high-value).
8. **Polish**: animations, the dice spectacle, undo/rewind UI, location quick-load,
   optional finish/delete-game + auto-expiry Alarm.

### Golden tests
Encoded in **RULES.md §12** (clock-tower turn, reinforcements, challenge, Downed-vs-Injury,
SPECIAL gating). Implement them as the engine's correctness suite.

---

## 6. Open questions / decisions to revisit

- **How much auto-advance vs GM-gated?** Default: GM confirms each phase transition in
  resolution. Could add a "fast mode" later.
- **Multiple simultaneous engagements** (a PC engaging 2 threats): supported by "GM pool
  = highest Attack + 1 per extra threat"; confirm UI makes the "which threats am I
  engaging" selection clear.
- **Spectators / extra seats** beyond 6+GM: allow read-only spectators (no seatToken, no
  interaction, just board view)?
- **Lost-token UX**: is GM seat-release enough, or do you want a "claim by name" reclaim
  prompt as well? (Default: GM release is sufficient for a friend group.)
- **Mobile layout** for the resolution theater (drag-allocation needs a tap fallback).

---

## 7. Tone reminder for any generated copy

Eat the Reich is gleeful, vulgar, over-the-top anti-fascist pulp. UI microcopy can lean
into that ("Drink deep", "Go out with a bang"), but the **safety tooling copy stays
plain and serious** — never jokey. The game is explicit that Hitler gets no monologue and
nazis get no in-character slurs; don't generate either.
