// Live smoke test of GM grant-loot + blood-share (the data the board's arc reads) against
// a real DO. Usage: node scripts/smoke-loot-share.mjs <port>
const PORT = process.argv[2] ?? "8787";
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) { console.error("✗ " + msg); process.exit(1); }
  console.log("✓ " + msg);
}

function connect(code) {
  const ws = new WebSocket(`${WS}/game/${code}`);
  const waiters = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(msg)) waiters.splice(i, 1)[0].resolve(msg);
  });
  return {
    ready: new Promise((res) => ws.addEventListener("open", res)),
    next: (pred) => new Promise((resolve) => waiters.push({ pred, resolve })),
    send: (intent) => ws.send(JSON.stringify({ t: "intent", intent })),
    raw: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
  };
}

const main = async () => {
  const { code } = await (await fetch(`${BASE}/game`, { method: "POST" })).json();
  const c = connect(code);
  await c.ready;
  await c.next((m) => m.t === "sync");
  c.raw({ t: "intent", intent: { kind: "claim_seat", seat: "gm" } });
  await c.next((m) => m.t === "seat_granted");

  // --- GM grant loot ---
  const item = { id: "loot-cross", name: "Particularly huge cross", uses: 3, loot: true, bonus: { tag: "swing for the fences", plus: 2 } };
  c.send({ kind: "loot_add", seat: "nicole", item });
  let s = (await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "LOOT_ADDED"))).state;
  const loot = s.characters.nicole.loot;
  assert(loot.length === 1 && loot[0].id === "loot-cross", "loot landed in Nicole's slots");
  assert(loot[0].bonus?.plus === 2 && loot[0].bonus?.tag === "swing for the fences", "the parsed bonus requirement came through");
  assert(s.characters.nicole.equipmentUses["loot-cross"] === 3, "loot carries 3 uses (rulebook p39)");

  c.send({ kind: "loot_activate", seat: "nicole", itemId: "loot-cross" });
  s = (await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "LOOT_ACTIVATED"))).state;
  assert(s.characters.nicole.activeLootSlot === "loot-cross", "the loot slot activates");

  // --- Blood share (the board arc reads from/to/amount off this event) ---
  c.send({ kind: "change_blood", seat: "iryna", delta: 3 });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "BLOOD_CHANGED"));
  c.send({ kind: "share_blood", from: "iryna", to: "nicole", amount: 2 });
  const shared = await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "BLOOD_SHARED"));
  s = shared.state;
  const ev = shared.events.find((e) => e.type === "BLOOD_SHARED").payload;
  assert(ev.from === "iryna" && ev.to === "nicole" && ev.amount === 2, "BLOOD_SHARED carries from/to/amount for the arc");
  assert(s.characters.iryna.blood === 1, "the giver was drained (3 → 1)");
  assert(s.characters.nicole.blood === 2, "the receiver was fed (+2)");

  c.close();
  console.log("\nAll live loot + blood-share assertions passed.");
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
