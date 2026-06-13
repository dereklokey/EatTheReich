import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEvent } from "@shared/events/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { DiceArena, type ThrowSpec } from "./DiceArena";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";

type Phase = "throw" | "rest" | "fade";
interface Live {
  id: string;
  kind: "player" | "gm";
  faces: DieFace[];
}

/**
 * The shared arena for a freeform out-of-turn roll (issue #17). It watches the event feed (NOT
 * reduced state — like the Rust Curse announcement) so a FREEFORM_ROLLED that ARRIVES while we're
 * connected throws its dice over the live board. A reconnect/resume, which replays the whole log,
 * only seeds the high-water mark and never re-throws history. The settled result lives on the sheet
 * (reduced from state, so it survives a reload); this is pure spectacle, skipped under reduce-effects.
 *
 * It reuses the turn arena's physics wholesale: the only new wiring is "mount the arena off a freeform
 * event instead of off currentTurn," and the lighter beat (throw → hold → fade, no GM-pool contest).
 * Each throw keys a fresh DiceArena so successive rolls never share stale bodies.
 */
export function FreeformArena({ events, seq }: { events: GameEvent[]; seq: number }) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const seen = useRef(0); // highest event seq we've accounted for
  const seeded = useRef(false); // have we taken our opening high-water mark yet?
  const [live, setLive] = useState<Live | null>(null);
  const [phase, setPhase] = useState<Phase>("throw");

  useEffect(() => {
    if (seq <= 0) return; // no real state synced yet
    if (!seeded.current) {
      // First real sync. The connect sync carries NO event history (room.ts sends events:[]), so we
      // can't take the high-water mark from the feed — seed it from the authoritative head (state.seq)
      // instead. This is what lets the FIRST post-connect roll animate (the old feed-based seed mistook
      // that first roll for history and skipped it); a resume/refresh still never re-throws the log,
      // since every event already in the game sits at or below this seq.
      seen.current = seq;
      seeded.current = true;
      return;
    }
    let latest: GameEvent | undefined;
    let maxSeq = seen.current;
    for (const e of events) {
      if (e.seq > maxSeq) maxSeq = e.seq;
      if (e.type === "FREEFORM_ROLLED" && e.seq > seen.current) latest = e;
    }
    seen.current = maxSeq; // advance past everything seen → each roll fires at most once
    if (!latest || latest.type !== "FREEFORM_ROLLED") return;
    if (reduced || latest.payload.faces.length === 0) return; // no spectacle in calm mode / empty throw
    setLive({ id: `ff-${latest.seq}`, kind: latest.payload.kind, faces: latest.payload.faces });
    setPhase("throw");
    play("concussion");
    play("clatter");
  }, [events, seq, reduced, play]);

  const onSettled = useCallback(() => {
    const faces = live?.faces ?? [];
    if (live?.kind === "player" && faces.includes(6)) play("crit");
    else if (faces.some((f) => f >= 4)) play("success");
    else play("discard");
    setPhase("rest");
  }, [live, play]);

  // Hold the rested dice a beat, fade, then clear — the result is already on the sheet.
  useEffect(() => {
    if (phase === "rest") {
      const t = setTimeout(() => setPhase("fade"), 1500);
      return () => clearTimeout(t);
    }
    if (phase === "fade") {
      const t = setTimeout(() => setLive(null), 650);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // Backstop: never strand the overlay if a settle report is somehow missed.
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setLive(null), 12000);
    return () => clearTimeout(t);
  }, [live]);

  if (!live) return null;
  const throws: ThrowSpec[] = [{ id: live.id, kind: live.kind, dice: live.faces }];
  return <DiceArena key={live.id} throws={throws} fading={phase === "fade"} onThrowSettled={onSettled} />;
}
