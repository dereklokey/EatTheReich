import { CHAR_IDS, type SeatId } from "@shared/events/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";

/** Display metadata for every seat (the GM plus the six fixed pregens, RULES §10). */
export interface SeatMeta {
  id: SeatId;
  name: string;
  blurb: string;
}

export const SEATS: SeatMeta[] = [
  { id: "gm", name: "Games Master", blurb: "Frame the scenes. Roll the Reich's dice." },
  ...CHAR_IDS.map((id): SeatMeta => {
    const sheet = CHARACTERS_BY_ID[id];
    return { id, name: sheet?.name ?? id, blurb: sheet?.blurb ?? "" };
  }),
];

export function seatName(id: SeatId): string {
  return SEATS.find((s) => s.id === id)?.name ?? id;
}
