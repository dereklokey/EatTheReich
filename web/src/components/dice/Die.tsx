import type { CSSProperties } from "react";
import type { DieFace } from "@shared/domain/types.js";
import "./dice.css";

/**
 * A single die (DESIGN.md §5). `player` dice show crimson Roman numerals on purple
 * marble (the 6 reads as a critical); `gm` dice show crimson pips on bone. Visual
 * state is independent of the face value so the resolution theater can flip a die to
 * success/critical/discarded as the staggered reveal plays (§6).
 */
export type DieKind = "player" | "gm";
export type DieVisualState = "normal" | "success" | "critical" | "discarded";

const ROMAN: Record<DieFace, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI" };

/** Standard pip layout: which of the 9 grid cells are filled for each face. */
const PIP_CELLS: Record<DieFace, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export interface DieProps {
  kind: DieKind;
  value: DieFace;
  state?: DieVisualState;
  /** A small drop-in animation when the die first appears (fresh roll / bonus die). */
  entering?: boolean;
  /** Stable per-die tilt so a tray of dice looks hand-scattered, not gridded. */
  tilt?: number;
  /** Override the CSS --die-size (e.g. "4rem" for the Last Stand). */
  size?: string;
  title?: string;
}

export function Die({ kind, value, state = "normal", entering, tilt, size, title }: DieProps) {
  const className = [
    "die",
    `die--${kind}`,
    state !== "normal" ? `die--${state}` : "",
    entering ? "die--enter" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style: CSSProperties & Record<string, string> = {} as never;
  if (tilt !== undefined) style["--die-tilt"] = `${tilt}deg`;
  if (size) style["--die-size"] = size;

  return (
    <div className={className} style={style} title={title} aria-label={`${kind} die showing ${value}`}>
      {kind === "player" ? (
        <span className="die__face">{ROMAN[value]}</span>
      ) : (
        <span className="die__pips">
          {Array.from({ length: 9 }, (_, cell) => (
            <span key={cell}>{PIP_CELLS[value].includes(cell) ? <span className="die__pip" /> : null}</span>
          ))}
        </span>
      )}
      {state === "discarded" && <span className="die__discard-stamp gothic">discard!</span>}
    </div>
  );
}

/** Deterministic small tilt from an index so a rendered tray looks scattered but stable. */
export function tiltFor(index: number): number {
  const seq = [-5, 3, -2, 6, -4, 1, -6, 4, -1, 5, -3, 2];
  return seq[index % seq.length]!;
}
