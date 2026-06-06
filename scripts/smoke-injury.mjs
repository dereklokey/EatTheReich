// Live smoke test of the INJURY_CHECK window + reactive gear against a real DO
// (wrangler dev on :8787). Drives the GM socket through a full turn to a parked injury,
// then resolves / shrugs it off / lights a cigarette. Exits non-zero on any failed assert.
const PORT = process.argv[2] ?? "8787";
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) {
    console.error("✗ " + msg);
    process.exit(1);
  }
  console.log("✓ " + msg);
}

function connect(code) {
  const ws = new WebSocket(`${WS}/game/${code}`);
  const waiters = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) {
        waiters.splice(i, 1)[0].resolve(msg);
      }
    }
  });
  return {
    ready: new Promise((res) => ws.addEventListener("open", res)),
    // wait for the next server message matching pred
    next: (pred) => new Promise((resolve) => waiters.push({ pred, resolve })),
    send: (intent) => ws.send(JSON.stringify({ t: "intent", intent })),
    raw: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
  };
}

const objective = { id: "obj1", name: "Crack the vault", kind: "objective", rating: 6 };
// Attack 6 → a 6-die GM pool, so undefended ≥1 success (an injury) is near-certain.
const threat = { id: "thr1", name: "Death squad", kind: "threat", rating: 4, attack: 6, startingAttack: 6, reinforces: true, restoresAtZero: true };

// Drive GM through a turn for `seat` up to a parked injury. Returns the synced state.
async function parkInjury(c, seat) {
  for (let attempt = 0; attempt < 8; attempt++) {
    c.send({ kind: "start_turn", seat, stat: "BRAWL", engagedThreatIds: ["thr1"] });
    await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "TURN_STARTED"));
    c.send({ kind: "roll", playerPoolDice: 1 });
    await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "DICE_ROLLED" && e.payload.who === "gm"));
    c.send({ kind: "resolve_discard" });
    await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "DICE_DISCARDED"));
    c.send({ kind: "commit" });
    const after = await c.next((m) => m.t === "sync" && m.events?.some((e) => ["INJURY_PENDING", "ALLOCATION_COMMITTED"].includes(e.type)));
    if (after.state.currentTurn?.pendingInjury) return after.state;
    // No GM die got through this time (rare) — try again with a fresh turn.
  }
  throw new Error("could not park an injury in 8 attempts");
}

const main = async () => {
  const res = await fetch(`${BASE}/game`, { method: "POST" });
  const { code } = await res.json();
  assert(typeof code === "string" && code.length > 0, `minted a join code (${code})`);

  const c = connect(code);
  await c.ready;
  await c.next((m) => m.t === "sync"); // initial snapshot on connect

  c.raw({ t: "intent", intent: { kind: "claim_seat", seat: "gm" } });
  await c.next((m) => m.t === "seat_granted" && m.seat === "gm");
  assert(true, "claimed the GM seat");

  c.send({ kind: "frame_scene", objectives: [objective], threats: [threat] });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "SCENE_FRAMED"));

  // --- Test 1: park an injury for Chuck, shrug it off with the cowboy hat ---
  let s = await parkInjury(c, "chuck");
  const pend = s.currentTurn.pendingInjury;
  assert(pend && pend.face >= 1 && pend.face <= 6, `commit PARKED an injury (d6=${pend.face}, ${pend.outcome.kind})`);
  assert(s.characters.chuck.injuries.every((n) => n === 0) || pend.outcome.kind !== "injury", "boxes not marked yet while parked");

  c.send({ kind: "use_equipment", seat: "chuck", itemId: "chuck-cowboy-hat" });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "EQUIPMENT_USED"));
  c.send({ kind: "resolve_injury", ignore: true });
  s = (await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "ALLOCATION_COMMITTED"))).state;
  assert(s.currentTurn === null, "shrug-off closed the turn");
  assert(s.characters.chuck.injuries.every((n) => n === 0), "cowboy hat shrugged the wound off — no boxes marked");
  assert(s.characters.chuck.equipmentUses["chuck-cowboy-hat"] === 0, "the hat was destroyed (0 uses left)");
  assert(s.actedThisRound.includes("chuck"), "the turn still counts as Chuck's action");

  // --- Test 2: park an injury for Astrid, take the hit ---
  s = await parkInjury(c, "astrid");
  const before = s.characters.astrid.injuries.reduce((a, b) => a + b, 0);
  c.send({ kind: "resolve_injury" });
  s = (await c.next((m) => m.t === "sync" && m.events?.some((e) => ["INJURY_MARKED", "DOWNED", "DEATH_LAST_STAND"].includes(e.type)))).state;
  const closed = s.currentTurn === null || s.currentTurn?.lastStand === true;
  assert(closed, "taking the hit resolved the window");
  const after = (s.characters.astrid.injuries || []).reduce((a, b) => a + b, 0);
  assert(after > before, `the wound was marked (${before} → ${after} boxes)`);

  // --- Test 3: cigarettes grant +2 Blood server-side ---
  assert(s.characters.iryna.blood === 0, "Iryna starts at 0 Blood");
  c.send({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" });
  s = (await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "BLOOD_CHANGED"))).state;
  assert(s.characters.iryna.blood === 2, "lighting a cigarette regained 2 Blood");
  assert(s.characters.iryna.equipmentUses["iryna-cigarettes"] === 0, "the cigarette was spent");

  c.close();
  console.log("\nAll live injury-check assertions passed.");
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
