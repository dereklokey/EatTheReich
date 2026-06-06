// Live smoke test of mid-allocation bonus dice + finish/delete-game against a real DO
// (wrangler dev). Usage: node scripts/smoke-lifecycle.mjs <port>
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
      if (waiters[i].pred(msg)) waiters.splice(i, 1)[0].resolve(msg);
    }
  });
  return {
    ready: new Promise((res) => ws.addEventListener("open", res)),
    next: (pred) => new Promise((resolve) => waiters.push({ pred, resolve })),
    send: (intent) => ws.send(JSON.stringify({ t: "intent", intent })),
    raw: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
  };
}

const objective = { id: "obj1", name: "Crack the vault", kind: "objective", rating: 6 };
const threat = { id: "thr1", name: "Death squad", kind: "threat", rating: 4, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true };

const main = async () => {
  const { code } = await (await fetch(`${BASE}/game`, { method: "POST" })).json();
  assert(typeof code === "string", `minted a join code (${code})`);

  const c = connect(code);
  await c.ready;
  await c.next((m) => m.t === "sync");
  c.raw({ t: "intent", intent: { kind: "claim_seat", seat: "gm" } });
  await c.next((m) => m.t === "seat_granted");
  c.send({ kind: "frame_scene", objectives: [objective], threats: [threat] });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "SCENE_FRAMED"));

  // --- Mid-allocation bonus dice ---
  c.send({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["thr1"] });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "TURN_STARTED"));
  c.send({ kind: "roll", playerPoolDice: 4 });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "DICE_ROLLED" && e.payload.who === "gm"));
  c.send({ kind: "resolve_discard" });
  let s = (await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "DICE_DISCARDED"))).state;
  const beforeDice = s.currentTurn.playerDice.length;
  const beforeSurv = s.currentTurn.survivors.length;

  c.send({ kind: "add_bonus_dice", count: 3, label: "flanking" });
  const ev = await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "BONUS_DICE_ROLLED"));
  s = ev.state;
  const rolled = ev.events.find((e) => e.type === "BONUS_DICE_ROLLED").payload;
  assert(rolled.results.length === 3, "rolled 3 bonus dice");
  assert(s.currentTurn.playerDice.length === beforeDice + 3, "the rolled dice joined the record");
  assert(s.currentTurn.survivors.length === beforeSurv + rolled.survivors.length, `survivors grew by the bonus survivors (${beforeSurv} → ${s.currentTurn.survivors.length})`);
  assert(s.currentTurn.playerPool.sources.at(-1).label === "+flanking", "the bonus pool source is tagged");
  c.send({ kind: "cancel_turn" });
  await c.next((m) => m.t === "sync" && m.events?.some((e) => e.type === "TURN_CANCELLED"));

  // --- Finish & delete game ---
  c.send({ kind: "delete_game" });
  await c.next((m) => m.t === "deleted");
  assert(true, "GM delete_game broadcast { t: 'deleted' }");

  // A fresh connection to the same code sees an empty, re-initialised room (storage wiped).
  const c2 = connect(code);
  await c2.ready;
  const fresh = await c2.next((m) => m.t === "sync");
  assert(fresh.state.board.objectives.length === 0 && fresh.state.board.threats.length === 0, "storage was wiped — the board is empty again");
  assert(!fresh.state.seats.gm?.claimed, "the GM seat is no longer claimed");
  assert(fresh.state.lifecycle === "lobby", "the room is back in the lobby");

  c.close();
  c2.close();
  console.log("\nAll live lifecycle assertions passed.");
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
