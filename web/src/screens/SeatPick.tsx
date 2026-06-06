import type { GameState } from "@shared/state/types.js";
import type { SeatId } from "@shared/events/types.js";
import { SEATS } from "@/game/seats";

/**
 * Seat pick (CLAUDE.md §3.6). Claimed seats are greyed regardless of online status so
 * two people can't hold the same character; presence dots show who's actually here.
 * A token-less returner lands here; the GM can release a seat to free a lost-token one.
 */
export function SeatPick({
  state,
  online,
  isGm,
  onClaim,
  onRelease,
}: {
  state: GameState;
  online: SeatId[];
  isGm: boolean;
  onClaim: (seat: SeatId) => void;
  onRelease: (seat: SeatId) => void;
}) {
  return (
    <div className="substrate grain min-h-full p-6">
      <h1 className="display text-3xl text-paper underline-squiggle inline-block">Take your seat</h1>
      <p className="mono text-paper-fade mt-2 text-sm">Claimed seats are locked. The GM can release one.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SEATS.map((seat) => {
          const claimed = state.seats[seat.id]?.claimed ?? false;
          const isOnline = online.includes(seat.id);
          return (
            <div key={seat.id} className={`paper ${claimed ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="display text-xl">{seat.name}</span>
                <span className={`dot ${isOnline ? "dot-online" : "dot-away"}`} title={isOnline ? "online" : "away"} />
              </div>
              <p className="mono text-xs text-paper-fade mt-1 min-h-8">{seat.blurb}</p>

              <div className="mt-3 flex items-center gap-2">
                {claimed ? (
                  <>
                    <span className="stamp text-xs">claimed</span>
                    {isGm && (
                      <button className="mono text-xs underline text-blood" onClick={() => onRelease(seat.id)}>
                        release
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="display text-paper bg-blood px-3 py-1 text-sm"
                    style={{ borderRadius: 2 }}
                    onClick={() => onClaim(seat.id)}
                  >
                    claim
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
