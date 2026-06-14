import { useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { GameEvent, EventType } from "@shared/events/types.js";
import { seatName } from "@/game/seats";

/**
 * Event log (issue #18). A read-for-all slide-over that renders the event feed as a
 * readable transcript — the human-facing twin of the GM's Rewind list. It reads the
 * same session-scoped feed the rewind panel does (`game.events`, capped client-side):
 * the connect sync carries no history (room.ts), so the log shows what's happened
 * since this device connected and fills as play continues.
 *
 * Defaults to "Highlights" — the narrative beats — hiding the per-die mechanical churn
 * (pool/roll/discard/allocate) behind an "All events" toggle so the story reads clean.
 */
type Tone = "default" | "fade" | "blood" | "hazard";

/** The per-die / per-phase mechanical churn — hidden in Highlights, shown under "All". */
const MINOR: ReadonlySet<EventType> = new Set<EventType>([
  "POOL_BUILT",
  "DICE_ROLLED",
  "DICE_DISCARDED",
  "BONUS_DICE_ROLLED",
  "DIE_ALLOCATED",
  "ALLOCATION_COMMITTED",
  "PASSIVE_APPLIED",
  "INJURY_CHECK_OPENED",
  "INJURY_PENDING",
]);

const TONE_CLASS: Record<Tone, string> = {
  default: "text-paper",
  fade: "text-paper-fade",
  blood: "text-blood",
  hazard: "text-hazard",
};

export function LogPanel({ state, events, onClose }: { state: GameState; events: GameEvent[]; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const rows = [...events].reverse().filter((e) => showAll || !MINOR.has(e.type));

  return (
    <div className="fixed inset-0 z-[69] flex justify-end">
      <button className="flex-1 bg-night-deep/70" aria-label="close" onClick={onClose} />
      <div className="w-full max-w-md h-full overflow-y-auto bg-night-top/98 border-l border-paper-shadow/30 p-4 pb-24">
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl text-paper">Event log</h2>
          <button className="mono text-sm underline text-paper-fade" onClick={onClose}>close</button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Toggle on={!showAll} label="Highlights" onClick={() => setShowAll(false)} />
          <Toggle on={showAll} label="All events" onClick={() => setShowAll(true)} />
        </div>

        {rows.length === 0 ? (
          <p className="mono text-xs text-paper-fade italic mt-4">
            {events.length === 0
              ? "Nothing logged yet this session. Actions appear here as they happen."
              : "No highlights yet — switch to “All events” for the mechanical detail."}
          </p>
        ) : (
          <ol className="mt-3 flex flex-col">
            {rows.map((e) => {
              const { text, tone } = describe(e, state);
              return (
                <li key={e.seq} className="flex items-baseline gap-2 py-1.5 border-b border-paper-shadow/15 mono text-xs">
                  <span className="shrink-0 text-[0.65rem] text-paper-fade tabular-nums">{clock(e.ts)}</span>
                  <span className={`flex-1 leading-snug ${TONE_CLASS[tone]}`}>{text}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`mono text-xs px-2 py-1 border ${on ? "bg-paper text-paper-ink border-paper" : "text-paper-fade border-paper-shadow/40"}`}
      style={{ borderRadius: 3 }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function clock(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Map an event to one readable line + a colour tone. Narrative beats are spelled out;
 * everything else falls back to a humanized type name + actor so nothing reads as a raw
 * enum. Names come off the payload where the event carries them (so completed/removed
 * board items still read), else from current board state.
 */
function describe(e: GameEvent, state: GameState): { text: string; tone: Tone } {
  const objName = (id: string) =>
    state.board.objectives.find((o) => o.id === id)?.name ??
    state.board.secondaryObjectives.find((o) => o.id === id)?.name ??
    "objective";
  const thrName = (id: string) => state.board.threats.find((t) => t.id === id)?.name ?? "threat";

  switch (e.type) {
    case "GAME_CREATED":
      return { text: "Game created.", tone: "fade" };
    case "PLAYER_JOINED":
      return { text: "A player joined.", tone: "fade" };
    case "ROLE_CLAIMED":
      return { text: `${seatName(e.payload.seat)} claimed a seat.`, tone: "fade" };
    case "SEAT_RELEASED":
      return { text: `${seatName(e.payload.seat)}’s seat was released.`, tone: "fade" };
    case "SESSION_STARTED":
      return { text: "Session started.", tone: "default" };
    case "SESSION_ENDED":
      return { text: "Session ended.", tone: "fade" };

    case "SAFETY_SET":
      return { text: "Lines & Veils updated.", tone: "default" };
    case "XCARD_RAISED":
      return { text: "✕ X-Card raised — table paused.", tone: "default" };
    case "XCARD_CLEARED":
      return {
        text: e.payload.changeRequested ? `X-Card cleared — “${e.payload.changeRequested}”.` : "X-Card cleared — resumed.",
        tone: "default",
      };
    case "TRAFFIC_SIGNAL":
      return { text: `Traffic signal: ${e.payload.color.toUpperCase()}.`, tone: "default" };

    case "SCENE_FRAMED":
      return { text: "Scene framed — board set.", tone: "default" };
    case "OBJECTIVE_ADDED":
      return { text: `Objective added: ${e.payload.objective.name}.`, tone: "default" };
    case "OBJECTIVE_UPDATED":
      return { text: `Objective edited: ${objName(e.payload.id)}.`, tone: "fade" };
    case "OBJECTIVE_COMPLETED":
      return { text: `✔ Objective completed: ${objName(e.payload.id)}.`, tone: "hazard" };
    case "THREAT_ADDED":
      return { text: `Threat added: ${e.payload.threat.name}.`, tone: "default" };
    case "THREAT_UPDATED":
      return { text: `Threat edited: ${thrName(e.payload.id)}.`, tone: "fade" };
    case "THREAT_REMOVED":
      return { text: `Threat removed: ${thrName(e.payload.id)}.`, tone: "fade" };
    case "GM_WHIFF":
      return { text: `${e.payload.name} presses the attack — Attack now ${e.payload.attack}.`, tone: "blood" };

    case "TURN_STARTED":
      return { text: `${seatName(e.payload.seat)} takes a turn.`, tone: "default" };
    case "TURN_CANCELLED":
      return { text: `${seatName(e.payload.seat)} cancelled their turn.`, tone: "fade" };
    case "ENEMY_CHALLENGE_RAISED":
      return { text: `${e.payload.threatName}’s Challenge rose +${e.payload.amount}.`, tone: "blood" };
    case "THREAT_ATTACK_REDUCED":
      return { text: `${e.payload.threatName} Attack −${e.payload.amount} → ${e.payload.attack} (${e.payload.specialName}).`, tone: "default" };
    case "THREAT_RATING_REDUCED":
      return { text: `${e.payload.threatName} rating −${e.payload.amount} → ${e.payload.rating} (${e.payload.passiveName}).`, tone: "default" };
    case "CHALLENGE_REDUCED": {
      const src = e.payload.specialName ?? e.payload.powerName;
      return { text: `${e.payload.targetName} Challenge −${e.payload.amount} → ${e.payload.challenge}${src ? ` (${src})` : ""}.`, tone: "default" };
    }

    case "INJURY_MARKED":
      return {
        text: `${seatName(e.payload.seat)} is wounded${e.payload.penalty ? ` — ${e.payload.penalty}` : ""}.`,
        tone: "blood",
      };
    case "DOWNED":
      return { text: `${seatName(e.payload.seat)} is Downed.`, tone: "blood" };
    case "CHARACTER_CAPTURED":
      return { text: `${seatName(e.payload.seat)} was captured.`, tone: "blood" };
    case "HEALED":
      return {
        text: `${seatName(e.payload.seat)} cleared an injury${e.payload.specialName ? ` (${e.payload.specialName})` : ""}.`,
        tone: "default",
      };
    case "DEATH_LAST_STAND":
      return { text: `${seatName(e.payload.seat)} — Last Stand!`, tone: "blood" };
    case "LAST_STAND_ROLLED":
      return { text: `${seatName(e.payload.seat)} throws the final 8 dice.`, tone: "blood" };
    case "LAST_STAND_ENDED":
      return { text: `${seatName(e.payload.seat)} goes out with a bang.`, tone: "blood" };

    case "BLOOD_CHANGED":
      return {
        text: `${seatName(e.payload.seat)} ${e.payload.delta >= 0 ? "+" : ""}${e.payload.delta} Blood${e.payload.reason ? ` (${e.payload.reason})` : ""}.`,
        tone: "blood",
      };
    case "BLOOD_SHARED":
      return { text: `${seatName(e.payload.from)} gave ${e.payload.amount} Blood to ${seatName(e.payload.to)}.`, tone: "blood" };

    case "EQUIPMENT_USED":
      return { text: `${seatName(e.payload.seat)} used a piece of equipment.`, tone: "fade" };
    case "EQUIPMENT_RESTORED":
      return { text: `${seatName(e.payload.seat)} restored a use of equipment.`, tone: "fade" };
    case "SCAVENGER_ROLLED":
      return {
        text: `${seatName(e.payload.seat)} salvage die ${e.payload.face}${e.payload.itemName ? ` — restored ${e.payload.itemName}` : " — nothing to salvage"}.`,
        tone: "default",
      };
    case "EQUIPMENT_DEGRADED":
      return { text: `${seatName(e.payload.seat)}’s ${e.payload.itemName} rusted (Rust Curse).`, tone: "blood" };
    case "LOOT_ADDED":
      return { text: `${seatName(e.payload.seat)} gained loot: ${e.payload.item.name}.`, tone: "default" };
    case "LOOT_ACTIVATED":
      return { text: `${seatName(e.payload.seat)} activated a loot item.`, tone: "default" };
    case "ADVANCE_UNLOCKED":
      return { text: `${seatName(e.payload.seat)} unlocked an advance.`, tone: "hazard" };

    case "SECONDARY_OBJECTIVE_ADDED":
      return { text: `Secondary objective added: ${e.payload.objective.name}.`, tone: "default" };
    case "SECONDARY_OBJECTIVE_UPDATED":
      return { text: `Secondary objective edited: ${objName(e.payload.id)}.`, tone: "fade" };
    case "SECONDARY_OBJECTIVE_COMPLETED":
      return { text: `✔ Secondary objective completed: ${objName(e.payload.id)}.`, tone: "hazard" };
    case "SECONDARY_OBJECTIVE_REWARD_APPLIED":
      return { text: `Reward applied: ${e.payload.rewardLabel}.`, tone: "default" };
    case "SECONDARY_OBJECTIVE_REMOVED":
      return { text: `Secondary objective removed: ${objName(e.payload.id)}.`, tone: "fade" };
    case "SCENE_LOOT_REVEALED":
      return { text: `Loot ${e.payload.revealed ? "revealed" : "hidden"}: ${e.payload.name}.`, tone: "fade" };

    case "STANCE_SET":
      return { text: `${seatName(e.payload.seat)} armed ${e.payload.powerName}.`, tone: "default" };
    case "FREEFORM_ROLLED": {
      const who = e.payload.seat === "gm" ? "The Reich" : seatName(e.payload.seat);
      return { text: `${who} threw ${e.payload.faces.length} dice (${e.payload.faces.join(", ")}).`, tone: "default" };
    }
    case "FLASHBACK_TRIGGERED":
      return { text: `${seatName(e.payload.seat)} took a flashback.`, tone: "default" };
    case "ROUND_ENDED":
      return { text: "Round ended.", tone: "default" };
    case "REINFORCEMENTS_APPLIED":
      return { text: "Reinforcements rolled.", tone: "blood" };
    case "GM_OVERRIDE":
      return { text: `GM override${e.payload.note ? `: ${e.payload.note}` : "."}`, tone: "fade" };

    // Mechanical churn (hidden under Highlights) — terse but still attributed.
    case "POOL_BUILT":
      return { text: `${e.payload.who === "gm" ? "Reich" : "Player"} pool built (${e.payload.dice} dice).`, tone: "fade" };
    case "DICE_ROLLED":
      return { text: `${e.payload.who === "gm" ? "Reich" : "Player"} rolled: ${e.payload.results.join(", ")}.`, tone: "fade" };
    case "DICE_DISCARDED":
      return { text: "Dice discarded.", tone: "fade" };
    case "BONUS_DICE_ROLLED":
      return { text: `Bonus dice +${e.payload.count}.`, tone: "fade" };
    case "DIE_ALLOCATED":
      return { text: `Allocated ${e.payload.units} → ${e.payload.kind}${e.payload.detail ? ` (${e.payload.detail})` : ""}.`, tone: "fade" };
    case "ALLOCATION_COMMITTED":
      return { text: "Allocation committed.", tone: "fade" };
    case "PASSIVE_APPLIED":
      return { text: `Passive fired: ${e.payload.passiveId}.`, tone: "fade" };
    case "INJURY_CHECK_OPENED":
      return { text: `${seatName(e.payload.seat)} — injury check.`, tone: "fade" };
    case "INJURY_PENDING":
      return { text: `${seatName(e.payload.seat)} injury die: ${e.payload.face}.`, tone: "fade" };

    default: {
      // Exhaustive fallback: humanize the type and tag the actor so nothing reads as raw enum.
      const ev = e as GameEvent;
      return { text: `${ev.type.toLowerCase().replace(/_/g, " ")} · ${ev.actor}`, tone: "fade" };
    }
  }
}
